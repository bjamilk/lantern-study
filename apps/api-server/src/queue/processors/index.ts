import { Worker, type Job } from "bullmq";
import { getQueueConnectionOptions } from "../connection";
import { QUEUE_NAMES } from "../jobs/types";
import { setJobStage, getJobRecord, refundJobCreditOnce } from "../jobStatus";
import type { JobError, JobResultRef } from "@lantern/shared/jobs/jobState";
import {
  generateQuestionsFromNotes,
  generateFlashcardsFromNotes,
  explainAnswer,
  getStudyRecommendations,
  askTutor,
  enhanceFlashcard,
  summarizeNoteContent,
  generateDailyQuiz,
  companionChat,
} from "../../services/aiService";
import { upsertSmartNotesSection } from "@lantern/shared/utils/smartNotes";
import { SupabaseService } from "../../services/supabase";
import { parseApkgBuffer } from "../../services/apkgImport";
import { runPresentationPreviewJob } from "../../services/presentationPreview";
import { runYoutubeTranscriptJob } from "../../services/youtubeNote";
import { runNoteOcrJob } from "../../services/noteOcr";
import { runDataRetentionPurge } from "../../services/dataRetention";
import {
  processAbandonedCheckoutReminders,
  processReviewReminders,
  processSavedSearchAlerts,
  processStaleOfferReminders,
} from "../../services/marketplaceAlerts";
import { processJobSavedSearchAlerts } from "../../services/jobAlerts";
import { processJobDeadlineReminders } from "../../services/jobReminders";
import {
  processStudyReminders,
  processWeeklySummary,
} from "../../services/retentionReminders";
import { logAIInference } from "../../services/aiInferenceLog";
import { normalizeSurface, recordLearningEvent } from "../../services/learningEvents";
import { buildTrustedCompanionContext } from "../../services/companionContext";
import { getStudyPackFactoryService } from "../../services/studyPackFactory";
import {
  buildNarrationScript,
  getNarrationBundle,
  markNarrationFailed,
  narrationApiPayload,
} from "../../services/narrationService";
import {
  ensureConversationTitle,
  parseCompanionUuid,
  resolveConversationForSend,
  touchConversation,
} from "../../services/companionConversations";

let supabaseService: SupabaseService;

export function initializeWorkerServices(supabase: SupabaseService): void {
  supabaseService = supabase;
}

async function recordInference(
  userId: string | undefined,
  feature: string,
  result: { provider?: string; model?: string },
): Promise<void> {
  if (!userId || !supabaseService) return;
  await logAIInference(supabaseService.getClient(), {
    userId,
    feature,
    provider: result.provider,
    model: result.model,
  });
}

/**
 * learning_events for the queued (async) AI paths — the sync paths emit in the
 * routes. surface/noteId/courseId ride on the job payload (routes stamp them).
 * Never throws.
 */
async function recordGenerationEvent(
  userId: string | undefined,
  eventType: "card_generated" | "question_generated",
  count: number,
  data: Record<string, unknown>,
): Promise<void> {
  if (!userId || !supabaseService) return;
  const noteId = typeof data.noteId === "string" ? data.noteId : null;
  await recordLearningEvent(supabaseService, {
    userId,
    eventType,
    targetType: noteId ? "note" : null,
    targetId: noteId,
    noteId,
    courseId: typeof data.courseId === "string" ? data.courseId : null,
    count,
    surface: normalizeSurface(data.surface),
  });
}

/**
 * What a processor uses to say where it has got to. Every call is best-effort:
 * a progress write that fails must never fail the student's actual work.
 */
export interface JobProgress {
  stage(stage: "reading" | "generating" | "saving", percent?: number): Promise<void>;
  /** Where the finished work will live, so the client can navigate to it. */
  ref(resultRef: JobResultRef): void;
  /** Read back by wrapProcessor when the job completes. */
  readonly resultRef?: JobResultRef;
}

function createProgress(job: Job): JobProgress {
  const state: { resultRef?: JobResultRef } = {};
  return {
    async stage(stage, percent) {
      if (!job.id) return;
      try {
        await setJobStage(job.id, stage, { percent });
      } catch (err) {
        console.error(`[queue] progress write failed for job ${job.id}:`, err);
      }
    },
    ref(resultRef) {
      state.resultRef = resultRef;
    },
    get resultRef() {
      return state.resultRef;
    },
  };
}

/** Anything the student could fix by changing their input is not retryable. */
function toJobError(err: unknown): JobError {
  const message = err instanceof Error ? err.message : String(err);
  const code =
    (err as { code?: unknown })?.code && typeof (err as { code?: unknown }).code === "string"
      ? ((err as { code: string }).code)
      : "JOB_FAILED";
  const permanent = /invalid|required|not found|unauthor|permission|too (large|long)|unsupported|unknown .* job/i.test(
    message,
  );
  return { code, message, retryable: !permanent };
}

async function processAiJob(job: Job, progress: JobProgress): Promise<unknown> {
  const userId = job.data.userId as string | undefined;
  const name = job.name;

  switch (name) {
    case "ai.generate.questions": {
      const { notes, count, difficulty, questionTypes, subject } = job.data;
      await progress.stage("generating");
      const result = await generateQuestionsFromNotes(notes, {
        count,
        difficulty,
        questionTypes,
        subject,
      });
      await recordInference(userId, "generate-questions", result);
      await recordGenerationEvent(
        userId,
        "question_generated",
        Array.isArray(result.questions) ? result.questions.length : 0,
        job.data,
      );
      return result;
    }
    case "ai.generate.flashcards": {
      const { notes, count, style, typeMix, difficulty } = job.data;
      await progress.stage("generating");
      const result = await generateFlashcardsFromNotes(notes, {
        count,
        style,
        typeMix,
        difficulty,
      });
      await recordInference(userId, "generate-flashcards", result);
      await recordGenerationEvent(
        userId,
        "card_generated",
        Array.isArray(result.flashcards) ? result.flashcards.length : 0,
        job.data,
      );
      return result;
    }
    case "ai.explain.answer": {
      const { question, userAnswer, correctAnswer, options } = job.data;
      await progress.stage("generating");
      const result = await explainAnswer(
        question,
        userAnswer || "",
        correctAnswer,
        options,
      );
      await recordInference(userId, "explain-answer", result);
      return result;
    }
    case "ai.study.recommendations": {
      await progress.stage("generating");
      const result = await getStudyRecommendations(job.data.performanceData);
      await recordInference(userId, "study-recommendations", result);
      return result;
    }
    case "ai.ask.tutor": {
      const { question, context } = job.data;
      await progress.stage("generating");
      const result = await askTutor(question, context);
      await recordInference(userId, "ask-tutor", result);
      return result;
    }
    case "ai.enhance.flashcard": {
      const { front, back } = job.data;
      await progress.stage("generating");
      const result = await enhanceFlashcard(front, back);
      await recordInference(userId, "enhance-flashcard", result);
      return result;
    }
    case "ai.companion.message": {
      const { message, context, conversationId, newConversation } = job.data as {
        message: string;
        context?: Record<string, unknown>;
        conversationId?: string | null;
        newConversation?: boolean;
      };
      if (!userId || !supabaseService) {
        throw new Error(
          "Companion message job requires userId and supabase service",
        );
      }
      const client = supabaseService.getClient();
      await progress.stage("reading");
      const trustedContext = await buildTrustedCompanionContext(
        supabaseService,
        userId,
        (context || {}) as Parameters<typeof buildTrustedCompanionContext>[2],
      );
      const threadNoteId = trustedContext.noteId || null;
      const conversation = await resolveConversationForSend(
        client,
        userId,
        parseCompanionUuid(conversationId ?? context?.conversationId),
        threadNoteId,
        { forceNew: newConversation === true || context?.newConversation === true },
      );
      const effectiveNoteId = conversation.note_context_id ?? threadNoteId;

      const { data: historyRows } = await client
        .from("ai_companion_messages")
        .select("role, content")
        .eq("user_id", userId)
        .eq("conversation_id", conversation.id)
        .order("created_at", { ascending: false })
        .limit(20);

      const history = (historyRows || []).reverse() as Array<{
        role: "user" | "assistant";
        content: string;
      }>;
      const trimmed = String(message).trim();
      await progress.stage("generating");
      const { reply, actions, provider } = await companionChat(
        trimmed,
        history,
        { ...trustedContext, noteId: effectiveNoteId || undefined },
      );
      await recordInference(userId, "companion-message", { provider });

      await progress.stage("saving");
      progress.ref({ type: "conversation", id: conversation.id });
      const now = new Date().toISOString();
      await client.from("ai_companion_messages").insert([
        {
          user_id: userId,
          role: "user",
          content: trimmed,
          created_at: now,
          note_context_id: effectiveNoteId,
          conversation_id: conversation.id,
        },
        {
          user_id: userId,
          role: "assistant",
          content: reply,
          actions: actions.length ? actions : null,
          created_at: new Date(Date.now() + 1).toISOString(),
          note_context_id: effectiveNoteId,
          conversation_id: conversation.id,
        },
      ]);
      await touchConversation(client, userId, conversation.id);
      await ensureConversationTitle(client, userId, conversation, trimmed);

      return { reply, actions, provider, conversationId: conversation.id };
    }
    case "notes.ai.summarize": {
      const { content, title, noteId, sourceType, guidance, depth } = job.data as {
        content: string;
        title?: string;
        noteId?: string;
        sourceType?: string;
        guidance?: string;
        depth?: "concise" | "standard" | "deep";
      };
      await progress.stage("generating");
      const result = await summarizeNoteContent(content, { title, sourceType, guidance, depth });
      await recordInference(userId, "summarize-note", result);
      if (noteId && userId && supabaseService) {
        await progress.stage("saving");
        progress.ref({ type: "note", id: noteId, route: `/notes/${noteId}` });
        const latest = await supabaseService.getNote(noteId, userId);
        const nextBody = upsertSmartNotesSection(latest.body || "", result.summary);
        const note = await supabaseService.updateNote(
          userId,
          noteId,
          { summary: result.summary, body: nextBody },
          { allowRetryOnConflict: true },
        );
        return { ...result, note };
      }
      return result;
    }
    case "notes.ai.quiz": {
      const { content, studyGoal, count, noteId } = job.data as {
        content: string;
        studyGoal?: string;
        count?: number;
        noteId?: string;
      };
      await progress.stage("generating");
      const result = await generateDailyQuiz(content, { studyGoal, count });
      await recordInference(userId, "note-quiz", result);
      await recordGenerationEvent(
        userId,
        "question_generated",
        Array.isArray(result.questions) ? result.questions.length : 0,
        job.data as Record<string, unknown>,
      );
      if (noteId && userId && supabaseService) {
        await progress.stage("saving");
        const questions = result.questions.map((q, index) => ({
          id: `nq-${index}`,
          text: q.text,
          type: q.type,
          options: q.options,
          correctAnswer: q.correctAnswer,
          explanation: q.explanation,
          topic: q.topic,
        }));
        const session = await supabaseService.upsertNoteQuiz(userId, noteId, {
          studyGoal: studyGoal || "retention",
          questions,
        });
        progress.ref({ type: "quiz", id: noteId, route: `/notes/${noteId}/quiz` });
        return session;
      }
      return result;
    }
    case "notes.ai.flashcards": {
      const { content, count, style, typeMix, difficulty } = job.data as {
        content: string;
        count?: number;
        style?: string;
        typeMix?: string;
        difficulty?: string;
      };
      await progress.stage("generating");
      const result = await generateFlashcardsFromNotes(content, {
        count,
        style: style as "concise" | "detailed" | undefined,
        typeMix,
        difficulty,
      });
      await recordInference(userId, "note-flashcards", result);
      await recordGenerationEvent(
        userId,
        "card_generated",
        Array.isArray(result.flashcards) ? result.flashcards.length : 0,
        job.data as Record<string, unknown>,
      );
      return result;
    }
    case "notes.ai.narration": {
      const { noteId, attachmentId, version, creditCost, title } = job.data as {
        noteId: string;
        attachmentId: string;
        version?: number;
        creditCost?: number;
        title?: string;
      };
      if (!noteId || !attachmentId || !userId || !supabaseService) {
        throw new Error("Narration job requires noteId, attachmentId and a user");
      }
      progress.ref({ type: "note", id: noteId, route: `/notes/${noteId}` });
      try {
        // Throws on total failure → the worker wrapper refunds the AI charge.
        await buildNarrationScript(
          supabaseService,
          { noteId, attachmentId, userId, version, creditCost, title },
          {
            stage: (stage) => progress.stage(stage),
            percent: (percent) => progress.stage("generating", percent),
          },
        );
        // The job's result is the WHOLE deck, not a summary of it: a client
        // that waited on this job renders what comes back, and a summary would
        // leave the player with nothing to speak until it fetched again.
        const bundle = await getNarrationBundle(supabaseService, {
          noteId,
          attachmentId,
          userId,
        });
        return narrationApiPayload(attachmentId, bundle.bundle);
      } catch (err) {
        // The row must say "failed" even though the throw is what refunds:
        // a student who comes back to the screen has to see why, not a
        // deck stuck at "writing".
        await markNarrationFailed(supabaseService, {
          attachmentId,
          userId,
          version: version || 1,
          message: err instanceof Error ? err.message : "The reading could not be written.",
        });
        throw err;
      }
    }
    case "ai.studyPack.generate": {
      const { draftId } = job.data as { draftId: string };
      if (!draftId || !supabaseService) {
        throw new Error("Study pack generation job requires draftId and supabase service");
      }
      await progress.stage("generating");
      progress.ref({ type: "studyPack", id: draftId, route: `/study-packs/drafts/${draftId}` });
      // Throws on total failure → the worker wrapper refunds the AI charge.
      return getStudyPackFactoryService(supabaseService).generate(draftId);
    }
    default:
      throw new Error(`Unknown AI job: ${name}`);
  }
}

async function processFileJob(job: Job, progress: JobProgress): Promise<unknown> {
  if (job.name === "deck.importApkg") {
    const { apkgBase64, userId } = job.data as {
      apkgBase64: string;
      userId: string;
    };
    const buffer = Buffer.from(apkgBase64, "base64");
    await progress.stage("reading");
    const importData = await parseApkgBuffer(buffer);
    await progress.stage("saving");
    const importedDeck = await supabaseService.importDeck(importData, userId);
    const deckId = (importedDeck as { id?: string })?.id;
    if (deckId) progress.ref({ type: "deck", id: deckId, route: `/flashcards/${deckId}` });
    return { success: true, data: importedDeck };
  }
  if (job.name === "notes.presentation.preview") {
    const {
      noteId,
      attachmentId,
      storagePath,
      fileName,
      meta,
      bufferBase64,
      extractedText,
    } = job.data as {
      noteId: string;
      attachmentId: string;
      storagePath: string;
      fileName: string;
      meta: Record<string, unknown>;
      bufferBase64?: string;
      extractedText?: string;
    };
    await progress.stage("reading");
    await runPresentationPreviewJob(supabaseService, {
      noteId,
      attachmentId,
      storagePath,
      fileName,
      meta: meta || {},
      buffer: bufferBase64 ? Buffer.from(bufferBase64, "base64") : undefined,
      extractedText,
    });
    return { success: true, attachmentId };
  }
  if (job.name === "notes.youtube.transcript") {
    const { noteId, attachmentId, videoId, meta } = job.data as {
      noteId: string;
      attachmentId: string;
      videoId: string;
      meta?: Record<string, unknown>;
    };
    await progress.stage("reading");
    const result = await runYoutubeTranscriptJob(supabaseService, {
      noteId,
      attachmentId,
      videoId,
      meta: meta || {},
    });
    return { success: result.status === "ready", ...result };
  }
  if (job.name === "notes.ocr.extract") {
    const {
      noteId,
      attachmentId,
      storagePath,
      fileName,
      sourceKind,
      meta,
      bufferBase64,
    } = job.data as {
      noteId: string;
      attachmentId: string;
      storagePath: string;
      fileName: string;
      sourceKind: "pdf" | "presentation" | "preview_pdf" | "image";
      meta?: Record<string, unknown>;
      bufferBase64?: string;
    };
    await progress.stage("reading");
    const result = await runNoteOcrJob(supabaseService, {
      noteId,
      attachmentId,
      storagePath,
      fileName,
      sourceKind,
      meta: meta || {},
      buffer: bufferBase64 ? Buffer.from(bufferBase64, "base64") : undefined,
    });
    if (result.status !== "ok") {
      // OCR soft-fails (job completes with success:false so the poller keeps
      // its contract) — the failure-path refund never fires, so refund here.
      await refundJobCharge(job).catch((err) => {
        console.error(`[queue] OCR credit refund failed for job ${job.id}:`, err);
      });
    }
    return { success: result.status === "ok", ...result };
  }
  throw new Error(`Unknown file job: ${job.name}`);
}

async function processExportJob(job: Job, progress: JobProgress): Promise<unknown> {
  if (job.name === "export.userData") {
    const { userId } = job.data as { userId: string };
    await progress.stage("generating");
    const archive = await supabaseService.exportUserData(userId);
    return { success: true, data: archive };
  }
  throw new Error(`Unknown export job: ${job.name}`);
}

async function processCronJob(job: Job, _progress: JobProgress): Promise<unknown> {
  if (job.name === "cron.dataRetention") {
    // Shared with in-process retention: AI log purges + overdue paused-account hard deletes.
    return runDataRetentionPurge(supabaseService);
  }
  if (job.name === "cron.marketplaceAlerts") {
    const saved = await processSavedSearchAlerts(supabaseService);
    const checkout = await processAbandonedCheckoutReminders(supabaseService);
    const offers = await processStaleOfferReminders(supabaseService);
    const reviews = await processReviewReminders(supabaseService);
    return { saved, checkout, offers, reviews };
  }
  if (job.name === "cron.jobAlerts") {
    const jobAlerts = await processJobSavedSearchAlerts(supabaseService);
    return { jobAlerts };
  }
  if (job.name === "cron.jobReminders") {
    return processJobDeadlineReminders(supabaseService);
  }
  if (job.name === "cron.studyReminders") {
    return processStudyReminders(supabaseService);
  }
  if (job.name === "cron.examReminders") {
    const { processExamReminders } = await import("../../services/examReminders");
    return processExamReminders(supabaseService);
  }
  if (job.name === "cron.weeklySummary") {
    return processWeeklySummary(supabaseService);
  }
  throw new Error(`Unknown cron job: ${job.name}`);
}

function wrapProcessor(processor: (job: Job, progress: JobProgress) => Promise<unknown>) {
  return async (job: Job) => {
    const progress = createProgress(job);
    // Every job starts by reading its input; processors move it on from there.
    await progress.stage("reading");
    try {
      const result = await processor(job, progress);
      await setJobStage(job.id!, "done", { result, resultRef: progress.resultRef });
      return result;
    } catch (err) {
      await setJobStage(job.id!, "failed", { error: toJobError(err) });
      await refundChargeOnFinalFailure(job).catch((refundErr) => {
        console.error(`[queue] Credit refund failed for job ${job.id}:`, refundErr);
      });
      throw err;
    }
  };
}

/** Refund whatever charge is stamped on this job's record (idempotent). */
async function refundJobCharge(job: Job): Promise<void> {
  const record = job.id ? await getJobRecord(job.id) : null;
  await refundJobCreditOnce(record);
}

/**
 * The request that enqueued this job reserved AI credits and answered 202 —
 * a 2xx, so the middleware's non-2xx auto-refund never fired. If this was the
 * job's final attempt, hand those credits back (markJobChargeRefunded makes
 * this idempotent across racing retries).
 */
async function refundChargeOnFinalFailure(job: Job): Promise<void> {
  const attemptsAllowed = job.opts?.attempts ?? 1;
  if (job.attemptsMade + 1 < attemptsAllowed) return;
  await refundJobCharge(job);
}

function envConcurrency(name: string, fallback: number, max = 32): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw) || raw < 1) return fallback;
  return Math.min(max, Math.floor(raw));
}

export function startWorkers(): Worker[] {
  const connection = getQueueConnectionOptions();
  const aiConcurrency = envConcurrency("AI_WORKER_CONCURRENCY", 2, 16);

  const aiWorker = new Worker(
    QUEUE_NAMES.AI_GENERATION,
    wrapProcessor(processAiJob),
    {
      connection,
      concurrency: aiConcurrency,
    },
  );

  const fileWorker = new Worker(
    QUEUE_NAMES.FILE_PROCESSING,
    wrapProcessor(processFileJob),
    {
      connection,
      concurrency: envConcurrency("FILE_WORKER_CONCURRENCY", 1, 8),
    },
  );

  const exportWorker = new Worker(
    QUEUE_NAMES.DATA_EXPORT,
    wrapProcessor(processExportJob),
    {
      connection,
      concurrency: envConcurrency("EXPORT_WORKER_CONCURRENCY", 1, 4),
    },
  );

  const cronWorker = new Worker(
    QUEUE_NAMES.MARKETPLACE_ALERTS,
    wrapProcessor(processCronJob),
    {
      connection,
      concurrency: 1,
    },
  );

  for (const worker of [aiWorker, fileWorker, exportWorker, cronWorker]) {
    worker.on("failed", (job, err) => {
      console.error(`Job ${job?.id} failed:`, err.message);
      // Crash/stall failures ("job stalled more than allowable limit") never
      // run wrapProcessor's catch — the process that owned the job is gone.
      // This hook DOES fire for them: record the failure and refund the
      // charge (idempotent, so overlap with the catch path is harmless).
      if (job?.id) {
        void setJobStage(job.id, "failed", { error: toJobError(err) }).catch(() => {});
        void refundChargeOnFinalFailure(job).catch((refundErr) => {
          console.error(`[queue] Credit refund failed for stalled job ${job.id}:`, refundErr);
        });
      }
    });
  }

  return [aiWorker, fileWorker, exportWorker, cronWorker];
}

export async function scheduleRepeatableCronJobs(): Promise<void> {
  const { getQueue } = await import("../queues");
  const alertsQueue = getQueue(QUEUE_NAMES.MARKETPLACE_ALERTS);
  if (!alertsQueue) return;

  await alertsQueue.add(
    "cron.dataRetention",
    {},
    { repeat: { pattern: "0 3 * * *" }, jobId: "repeat-data-retention" },
  );
  await alertsQueue.add(
    "cron.marketplaceAlerts",
    {},
    { repeat: { every: 15 * 60 * 1000 }, jobId: "repeat-marketplace-alerts" },
  );
  await alertsQueue.add(
    "cron.jobAlerts",
    {},
    { repeat: { every: 15 * 60 * 1000 }, jobId: "repeat-job-alerts" },
  );
  await alertsQueue.add(
    "cron.jobReminders",
    {},
    { repeat: { every: 15 * 60 * 1000 }, jobId: "repeat-job-reminders" },
  );
  await alertsQueue.add(
    "cron.studyReminders",
    {},
    { repeat: { every: 4 * 60 * 60 * 1000 }, jobId: "repeat-study-reminders" },
  );
  await alertsQueue.add(
    // Hourly, not four-hourly: the 06:00-local gate means a slower loop could
    // deliver a "your exam is today" reminder in the afternoon.
    "cron.examReminders",
    {},
    { repeat: { every: 60 * 60 * 1000 }, jobId: "repeat-exam-reminders" },
  );
  await alertsQueue.add(
    "cron.weeklySummary",
    {},
    { repeat: { pattern: "0 8 * * 1" }, jobId: "repeat-weekly-summary" },
  );
}
