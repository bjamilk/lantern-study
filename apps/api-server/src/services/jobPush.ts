// ===========================================
// Lantern Study - Server-side job completion push
// ===========================================
//
// The client poller stops when the app is backgrounded, so a student who
// starts a generation and leaves is told nothing until they come back — on
// device, a quiz finished at +3 s and the notification only appeared 262 s
// later, when the app was foregrounded again. The server is the only party
// that knows a job finished while the phone is asleep, so it sends the push.
//
// Everything here is best-effort. A push that fails must never fail, retry or
// re-charge the student's job: every entry point swallows its errors and says
// so in the return value.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  buildJobPushMessage,
  jobPushIdempotencyKey,
  type JobPushMessage,
} from "@lantern/shared/jobs/jobPush";
import {
  type JobPushAudit,
  type JobPushSkipReason,
  type JobPushTicket,
  type JobStage,
} from "@lantern/shared/jobs/jobState";
import { getRedisClient, redisKey } from "./redisStore";
import { shouldSendExpoPush } from "../utils/userSettingsPolicy";
import { logger } from "../utils/logger";

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

/** Expo's documented per-request limit. */
const EXPO_PUSH_BATCH_SIZE = 100;

/** How long a "this push was sent" claim lives — the job record's own TTL. */
const PUSH_CLAIM_TTL_SECONDS = 60 * 60 * 24;

export interface ExpoPushEnvelope {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound?: "default";
  priority?: "high";
  channelId?: string;
}

/** Kill switch. Default on; `JOB_PUSH_ENABLED=false` turns every send into a no-op. */
export function isJobPushEnabled(): boolean {
  const raw = process.env.JOB_PUSH_ENABLED;
  if (raw === undefined || raw === null || raw === "") return true;
  return !/^(0|false|off|no)$/i.test(String(raw).trim());
}

/** Expo only accepts its own token format; anything else is a wasted request. */
export function isExpoPushToken(token: unknown): token is string {
  return (
    typeof token === "string" &&
    (token.startsWith("ExponentPushToken") || token.startsWith("ExpoPushToken"))
  );
}

export function chunkPushMessages<T>(
  messages: T[],
  size: number = EXPO_PUSH_BATCH_SIZE,
): T[][] {
  const step = Math.max(1, Math.floor(size));
  const chunks: T[][] = [];
  for (let i = 0; i < messages.length; i += step) {
    chunks.push(messages.slice(i, i + step));
  }
  return chunks;
}

/** The wire envelope for one device. */
export function toExpoEnvelope(token: string, message: JobPushMessage): ExpoPushEnvelope {
  return {
    to: token,
    title: message.title,
    body: message.body,
    data: message.data as unknown as Record<string, unknown>,
    sound: "default",
    // A finished generation is what the student is waiting on: it should wake
    // the device rather than sit in Android's deferred bucket.
    priority: "high",
    channelId: "default",
  };
}

type FetchLike = (input: string, init: Record<string, unknown>) => Promise<{ ok: boolean; status: number; text?: () => Promise<string>; json?: () => Promise<unknown> }>;

export interface ExpoSendReport {
  /** Envelopes Expo accepted with a 2xx. */
  delivered: number;
  /** One line per envelope Expo answered for, in the order it answered. */
  tickets: JobPushTicket[];
}

/** Expo answers `{ data: [{ status, id } | { status, message, details }] }`. */
export function parseExpoTickets(body: unknown): JobPushTicket[] {
  const rows = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const ticket = (row ?? {}) as Record<string, unknown>;
    const status = ticket.status === "ok" ? "ok" : "error";
    const out: JobPushTicket = { status };
    if (typeof ticket.id === "string") out.id = ticket.id;
    if (typeof ticket.message === "string") out.message = ticket.message;
    if (status === "error" && !out.message) out.message = "Expo returned an error with no message.";
    return out;
  });
}

/**
 * POST the envelopes to Expo, 100 at a time, and keep what it said back.
 *
 * Receipts (the second, asynchronous half of Expo's delivery report) are still
 * not polled — but the TICKETS are now recorded, because on device a push that
 * never arrived was indistinguishable from a push the server never sent.
 *
 * Never throws. A batch whose transport failed contributes one `error` ticket.
 */
export async function sendExpoPushDetailed(
  envelopes: ExpoPushEnvelope[],
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<ExpoSendReport> {
  if (!envelopes.length) return { delivered: 0, tickets: [] };
  let delivered = 0;
  const tickets: JobPushTicket[] = [];
  for (const batch of chunkPushMessages(envelopes)) {
    try {
      const response = await fetchImpl(EXPO_PUSH_ENDPOINT, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(batch),
      });
      if (response.ok) {
        delivered += batch.length;
        let parsed: JobPushTicket[] = [];
        try {
          parsed = response.json ? parseExpoTickets(await response.json()) : [];
        } catch {
          parsed = [];
        }
        tickets.push(...parsed);
        const errors = parsed.filter((t) => t.status === "error");
        if (errors.length) {
          logger.warn("Expo job push returned error tickets", {
            count: errors.length,
            messages: errors.map((t) => t.message).slice(0, 5),
          });
        }
      } else {
        logger.warn("Expo job push rejected", { status: response.status });
        tickets.push({ status: "error", message: `Expo HTTP ${response.status}` });
      }
    } catch (err) {
      logger.warn("Expo job push failed", { err });
      tickets.push({
        status: "error",
        message: err instanceof Error ? err.message : "Expo request failed",
      });
    }
  }
  return { delivered, tickets };
}

/** Back-compat wrapper: how many envelopes a 2xx accepted. */
export async function sendExpoPush(
  envelopes: ExpoPushEnvelope[],
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<number> {
  return (await sendExpoPushDetailed(envelopes, fetchImpl)).delivered;
}

/**
 * Claim this (job, stage) push exactly once.
 *
 * A terminal transition can be written by more than one party — the processor's
 * catch, BullMQ's `failed` hook for a stalled job, and the timeout reconciler —
 * so the NX key, not the caller, is what makes the student's phone buzz once.
 * With no Redis there are no job records either, so nothing to notify about.
 */
export async function claimJobPush(jobId: string, stage: JobStage): Promise<boolean> {
  const client = await getRedisClient();
  if (!client) return false;
  const result = await client.set(redisKey(jobPushIdempotencyKey(jobId, stage)), "1", {
    NX: true,
    EX: PUSH_CLAIM_TTL_SECONDS,
  });
  return result === "OK";
}

let cachedClient: SupabaseClient | null = null;

/** Inject a client (tests, and any process that already holds one). */
export function setJobPushSupabaseClient(client: SupabaseClient | null): void {
  cachedClient = client;
}

function getSupabase(): SupabaseClient | null {
  if (cachedClient) return cachedClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  cachedClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cachedClient;
}

export interface JobPushRecipient {
  tokens: string[];
  settings: unknown;
}

/**
 * The owner's registered devices. Today a profile holds a single
 * `expo_push_token`; the array is what the sender speaks, so adding a
 * `push_tokens` table later changes only this function.
 */
export async function getJobPushRecipient(
  userId: string,
): Promise<JobPushRecipient | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("expo_push_token, settings")
    .eq("id", userId)
    .single();
  if (error || !data) return null;
  const token = (data as { expo_push_token?: unknown }).expo_push_token;
  return {
    tokens: isExpoPushToken(token) ? [token] : [],
    settings: (data as { settings?: unknown }).settings,
  };
}

export interface JobPushJob {
  id: string;
  userId?: string;
  kind: Parameters<typeof buildJobPushMessage>[0]["kind"];
  stage: JobStage;
  result?: unknown;
  resultRef?: Parameters<typeof buildJobPushMessage>[0]["resultRef"];
  error?: Parameters<typeof buildJobPushMessage>[0]["error"];
  sourceTitle?: string;
}

export type JobPushOutcome =
  | "sent"
  | "disabled"
  | "no_message"
  | "no_owner"
  | "no_token"
  | "settings_off"
  | "already_sent"
  | "error";

/**
 * The record-facing reason for an outcome that did NOT reach a device.
 * `sent` has no reason — the tickets speak for it.
 */
export function pushSkipReasonFor(outcome: JobPushOutcome): JobPushSkipReason | undefined {
  switch (outcome) {
    case "sent":
      return undefined;
    case "disabled":
      return "disabled";
    case "no_message":
      return "not_pushable";
    case "no_owner":
      return "no_owner";
    case "no_token":
      return "no_token";
    case "settings_off":
      return "prefs_off";
    case "already_sent":
      return "claimed";
    default:
      return "error";
  }
}

export interface NotifyJobDeps {
  claim?: (jobId: string, stage: JobStage) => Promise<boolean>;
  getRecipient?: (userId: string) => Promise<JobPushRecipient | null>;
  send?: (envelopes: ExpoPushEnvelope[]) => Promise<number | ExpoSendReport>;
  /**
   * Persist the audit onto the job record. Injected by the queue (the only
   * module that owns the record store) so this service stays I/O-testable.
   */
  recordPush?: (jobId: string, push: JobPushAudit) => Promise<void>;
  now?: () => Date;
}

function normalizeSendResult(result: number | ExpoSendReport): ExpoSendReport {
  return typeof result === "number" ? { delivered: result, tickets: [] } : result;
}

/**
 * Push a finished job to its owner's devices, and RECORD what happened.
 *
 * Never throws — the caller is the queue's terminal transition, and a job the
 * student paid for must not fail because a notification did. Every exit writes
 * a `push` audit onto the record (best effort) so GET /jobs/:id can tell its
 * owner "no device is registered" instead of leaving them staring at a screen
 * that promised a notification and never buzzed.
 */
export async function notifyJobTerminal(
  job: JobPushJob,
  deps: NotifyJobDeps = {},
): Promise<JobPushOutcome> {
  const attemptedAt = (deps.now ? deps.now() : new Date()).toISOString();
  let audit: JobPushAudit = { attemptedAt };

  const finish = async (outcome: JobPushOutcome): Promise<JobPushOutcome> => {
    const skippedReason = pushSkipReasonFor(outcome);
    const push: JobPushAudit = {
      ...audit,
      ...(skippedReason ? { skippedReason } : {}),
    };
    logger.info("Job completion push", {
      jobId: job.id,
      userId: job.userId,
      kind: job.kind,
      stage: job.stage,
      outcome,
      skippedReason,
      tokenCount: push.tokenCount ?? 0,
      ticketErrors: (push.expoTickets ?? []).filter((t) => t.status === "error").length,
      url: push.url,
    });
    if (deps.recordPush) {
      try {
        await deps.recordPush(job.id, push);
      } catch (err) {
        logger.warn("Job push audit could not be recorded", { jobId: job.id, err });
      }
    }
    return outcome;
  };

  try {
    if (!isJobPushEnabled()) return await finish("disabled");
    if (!job.userId) return await finish("no_owner");

    const message = buildJobPushMessage({
      jobId: job.id,
      kind: job.kind,
      stage: job.stage,
      result: job.result,
      resultRef: job.resultRef,
      error: job.error,
      sourceTitle: job.sourceTitle,
    });
    if (!message) return await finish("no_message");
    audit = { ...audit, url: message.data.url };

    const recipient = await (deps.getRecipient ?? getJobPushRecipient)(job.userId);
    audit = { ...audit, tokenCount: recipient?.tokens.length ?? 0 };
    if (!recipient || recipient.tokens.length === 0) return await finish("no_token");
    if (!shouldSendExpoPush(recipient.settings, message.data.type)) {
      return await finish("settings_off");
    }

    // Claimed last, so a student whose settings or tokens change later is not
    // permanently barred from a push that was never actually sent.
    const claimed = await (deps.claim ?? claimJobPush)(job.id, job.stage);
    if (!claimed) return await finish("already_sent");

    const envelopes = recipient.tokens.map((token) => toExpoEnvelope(token, message));
    const report = normalizeSendResult(
      await (deps.send ?? sendExpoPushDetailed)(envelopes),
    );
    audit = { ...audit, expoTickets: report.tickets };
    return await finish("sent");
  } catch (err) {
    logger.warn("Job completion push failed", { jobId: job.id, stage: job.stage, err });
    audit = { ...audit, error: err instanceof Error ? err.message : String(err) };
    return await finish("error");
  }
}
