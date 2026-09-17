/**
 * The worker half of the job lifecycle: the BullMQ processors that do the work
 * a route offloaded, and the wrapper that keeps every one of them honest about
 * stage, result and credit.
 *
 * Exports:
 * - `startWorkers` — called at boot (server.ts) once Redis is wired; starts one
 *   Worker per queue: `ai-generation`, `file-processing`, `data-export` and
 *   `marketplace-alerts`.
 * - `scheduleRepeatableCronJobs` — registers the repeatable cron jobs, each with
 *   a fixed `jobId` so a redeploy replaces its schedule instead of stacking a
 *   second one.
 * - `initializeWorkerServices` — injects the service-role data layer the
 *   processors use.
 * - `processAiJob` and the `JobProgress` interface.
 *
 * What it touches: every AI provider path in `services/aiService.ts`, the
 * study-pack factory, narration, OCR, presentation preview, YouTube transcript
 * and APKG import services; Supabase tables through the service-role client
 * (`ai_companion_messages`, notes, decks, note quizzes, `learning_events`, the
 * AI inference log); and the Redis job records via `queue/jobStatus.ts`.
 *
 * Service role bypasses RLS. Every processor here runs with the service-role
 * client and must carry its own ownership predicate — the companion handler
 * re-reads attachments and history filtered by `user_id` for exactly this
 * reason.
 *
 * Lifecycle contract that `wrapProcessor` enforces for all four workers:
 * - Stage: every job is stamped `reading` before the processor runs; the
 *   processor moves it on with `progress.stage(...)`; the wrapper stamps `done`
 *   or `failed`. Progress writes are best-effort — a failed progress write must
 *   never fail the student's actual work — and `advanceJobStage` refuses to
 *   move a record that is already terminal, so a straggler cannot un-finish a
 *   job or reopen its refund.
 * - Credit: the enqueueing request already spent the AI credit and answered
 *   202, so the queue owns the refund. It fires on final failure, on a stall
 *   the process never lived to catch, and on a soft-failed OCR;
 *   `refundJobCreditOnce` makes all of those idempotent.
 */
import { UnrecoverableError, Worker, type Job } from "bullmq";
import { bestEffortWrite } from "../../services/data/writeResult";
import { getQueueConnectionOptions } from "../connection";
import { QUEUE_NAMES } from "../jobs/types";
import { setJobStage, getJobRecord, refundJobCreditOnce } from "../jobStatus";
import { JOB_STALE_TIMEOUT_MS } from "@lantern/shared/jobs/jobState";
import type { JobError, JobResultRef } from "@lantern/shared/jobs/jobState";
import {
  generateQuestionsFromNotes,
  generateFlashcardsFromNotes,
  generateLessonFromNotes,
  generateRecapFromNotes,
  generateTopicMaterials,
  gradeEssayFromDraft,
  explainAnswer,
  getStudyRecommendations,
  askTutor,
  enhanceFlashcard,
  summarizeNoteContent,
  generateDailyQuiz,
  companionChat,
} from "../../services/aiService";
import { upsertSmartNotesSection } from "@lantern/shared/utils/smartNotes";
import { type DataLayer } from "../../services/data";
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
import {
  collectCompanionImageAttachmentIds,
  loadTrustedCompanionImages,
} from "../../services/companionImageAttachments";
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

// ---------------------------------------------------------------------------
// Worker-side services and telemetry
//
// The workers run in the same process as the API but outside any request, so
// they have no `req.supabase`; server.ts injects the service-role client here
// at boot. Both telemetry helpers no-op rather than throw when it is missing.
// ---------------------------------------------------------------------------

/**
 * The worker's handle on the database. `worker.ts` builds it with
 * `createRuntimeDataLayer` — the SAME factory call `server.ts` makes, rather
 * than a second hand-written wiring, which is what let the two disagree about
 * `supabaseUrl` (monolith lane M3, Phase B).
 *
 * The two processor suites inject a bare stub through this same entry point
 * and reach only the members they stub, as before.
 */
let dataLayer: DataLayer;

export function initializeWorkerServices(layer: DataLayer): void {
  dataLayer = layer;
}

async function recordInference(
  userId: string | undefined,
  feature: string,
  result: { provider?: string; model?: string },
): Promise<void> {
  if (!userId || !dataLayer) return;
  await logAIInference(dataLayer.getClient(), {
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
  if (!userId || !dataLayer) return;
  const noteId = typeof data.noteId === "string" ? data.noteId : null;
  await recordLearningEvent(dataLayer, {
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

// ---------------------------------------------------------------------------
// Progress reporting and error classification
//
// `progress.stage` is also the job's heartbeat: it refreshes the record's
// `updatedAt`, which is what `reconcileJobTimeout` measures staleness from. A
// processor that goes quiet for longer than JOB_STALE_TIMEOUT_MS (10 min) is
// timed out and refunded even though it is still working.
// ---------------------------------------------------------------------------

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

/**
 * FIXED (F7a): a heartbeat for work that makes no progress writes of its own.
 *
 * `reconcileJobTimeout` measures SILENCE, not elapsed time: a record whose
 * `updatedAt` has not moved for JOB_STALE_TIMEOUT_MS (10 min) is stamped
 * `timed_out` and refunded by the next poll, even though the worker is still
 * running — after which `advanceJobStage` refuses the eventual `done` because
 * the record is already terminal. A study pack is up to a dozen chat
 * completions, each with a 120 s timeout plus rate-limit backoff, so it sat
 * squarely past that window.
 *
 * The tick re-stamps the current stage, which is exactly what refreshes
 * `updatedAt`, and it also calls `job.updateProgress` so BullMQ sees the job as
 * live rather than stalled. Both are best-effort: a heartbeat that throws must
 * never fail the work it is reporting on. The interval is well under the stale
 * window, so the reconciler only ever has to outlast one missed tick.
 */
const JOB_HEARTBEAT_INTERVAL_MS = (() => {
  const raw = Number(process.env.JOB_HEARTBEAT_INTERVAL_MS);
  const chosen = Number.isFinite(raw) && raw >= 1000 ? Math.floor(raw) : 60_000;
  // Never at or above the stale window — that would be no heartbeat at all.
  return Math.min(chosen, Math.floor(JOB_STALE_TIMEOUT_MS / 2));
})();

export async function withJobHeartbeat<T>(
  job: Job,
  progress: JobProgress,
  stage: "reading" | "generating" | "saving",
  fn: () => Promise<T>,
  intervalMs: number = JOB_HEARTBEAT_INTERVAL_MS,
): Promise<T> {
  let beats = 0;
  const timer = setInterval(() => {
    beats += 1;
    void (async () => {
      try {
        await progress.stage(stage);
        await job.updateProgress({ heartbeat: beats, at: new Date().toISOString() });
      } catch (err) {
        console.error(`[queue] heartbeat failed for job ${job.id}:`, err);
      }
    })();
  }, intervalMs);
  // Never hold the process open for a heartbeat.
  if (typeof timer.unref === "function") timer.unref();
  try {
    return await fn();
  } finally {
    clearInterval(timer);
  }
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

// ---------------------------------------------------------------------------
// ai-generation queue
//
// Every AI job name in `QUEUE_FOR_JOB` lands here. The shape each case returns
// is a client contract: for names a route also serves synchronously, the object
// must match that route's response exactly, because in production BullMQ is
// what answers and anything dropped here never reaches the client.
//
// Throwing is how a processor asks for the credit back — `wrapProcessor` marks
// the job failed and refunds. A case that wants to report failure without a
// refund returns a `success: false` payload instead (see the OCR case).
// ---------------------------------------------------------------------------

export async function processAiJob(job: Job, progress: JobProgress): Promise<unknown> {
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
    case "ai.generate.lesson": {
      const { notes, mode, sourceTitle, subject } = job.data;
      await progress.stage("generating");
      const result = await generateLessonFromNotes(notes, {
        mode,
        sourceTitle,
        subject,
      });
      await recordInference(userId, "generate-lesson", result);
      return result;
    }
    case "ai.generate.recap": {
      const { notes, style, length, sourceTitle, subject } = job.data;
      await progress.stage("generating");
      const result = await generateRecapFromNotes(notes, {
        style,
        length,
        sourceTitle,
        subject,
      });
      await recordInference(userId, "generate-recap", result);
      return result;
    }
    case "ai.generate.topic": {
      const { topic, subject, level, count } = job.data;
      await progress.stage("generating");
      const result = await generateTopicMaterials(topic, { subject, level, count });
      await recordInference(userId, "generate-from-topic", result);
      return result;
    }
    case "ai.generate.essay": {
      const { draft, rubricText, prompt, sourceNotes, sourceTitle } = job.data;
      await progress.stage("generating");
      const result = await gradeEssayFromDraft(draft, {
        rubricText,
        prompt,
        sourceNotes,
        sourceTitle,
      });
      await recordInference(userId, "grade-essay", result);
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
      if (!userId || !dataLayer) {
        throw new Error(
          "Companion message job requires userId and supabase service",
        );
      }
      const client = dataLayer.getClient();
      await progress.stage("reading");
      // Photos attached to this turn.
      //
      // In production BullMQ answers the JSON `/message` route — the ONLY
      // route mobile uses, since React Native cannot read a streamed body — so
      // this handler, not the one in routes/aiCompanion.ts, is what builds the
      // prompt. It never loaded the transcripts, so a student was charged two
      // AI uses to have a photo read and then told "I'm not seeing an image
      // here". The ids are all that is believed; the text is read back from
      // the table for rows this user owns, exactly as the HTTP path does.
      const trustedContext = await buildTrustedCompanionContext(dataLayer,
        userId,
        {
          ...((context || {}) as Parameters<typeof buildTrustedCompanionContext>[2]),
          imageAttachments: undefined,
        },
      );
      trustedContext.imageAttachments = await loadTrustedCompanionImages(dataLayer,
        userId,
        collectCompanionImageAttachmentIds(context),
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
      const { reply, actions, provider, citations, guidedStep } = await companionChat(
        trimmed,
        history,
        { ...trustedContext, noteId: effectiveNoteId || undefined },
      );
      await recordInference(userId, "companion-message", { provider });

      await progress.stage("saving");
      progress.ref({ type: "conversation", id: conversation.id });
      const now = new Date().toISOString();
      // BEST EFFORT at ERROR level (#108): this stores the STUDENT's turn, and
      // the assistant's reply is written beside it. Losing it leaves a
      // conversation whose question is missing and whose answer is not.
      //
      // Idempotency is moot here rather than satisfied: because this write
      // cannot fail the job, the job is never retried for it, so nothing
      // re-runs and nothing is duplicated. Making it throw would hand the
      // decision to BullMQ's retry — and a retried companion job re-bills the
      // inference, so it must not.
      bestEffortWrite(
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
      ]),
        {
          table: "ai_companion_messages",
          op: "insert",
          userId,
          conversationId: conversation.id,
          reason: "companion_turn",
        },
        "error",
        "companion-transcript-write-failed",
      );
      await touchConversation(client, userId, conversation.id);
      await ensureConversationTitle(client, userId, conversation, trimmed);

      // Must stay identical to the synchronous handler's shape in
      // routes/aiCompanion.ts: in production BullMQ answers the JSON route, so
      // anything dropped here never reaches the mobile client.
      return {
        reply,
        actions,
        provider,
        citations: citations ?? null,
        conversationId: conversation.id,
        // Guided only. This is the path EVERY mobile send takes, so a lesson
        // that advanced here and nowhere else would still restart on the phone.
        guidedStep: guidedStep ?? null,
      };
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
      if (noteId && userId && dataLayer) {
        await progress.stage("saving");
        progress.ref({ type: "note", id: noteId, route: `/notes/${noteId}` });
        const latest = await dataLayer.notes.getNote(noteId, userId);
        const nextBody = upsertSmartNotesSection(latest.body || "", result.summary);
        const note = await dataLayer.notes.updateNote(
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
      if (noteId && userId && dataLayer) {
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
        const session = await dataLayer.notes.upsertNoteQuiz(userId, noteId, {
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
      if (!noteId || !attachmentId || !userId || !dataLayer) {
        throw new Error("Narration job requires noteId, attachmentId and a user");
      }
      progress.ref({ type: "note", id: noteId, route: `/notes/${noteId}` });
      try {
        // Throws on total failure → the worker wrapper refunds the AI charge.
        await buildNarrationScript(dataLayer,
          { noteId, attachmentId, userId, version, creditCost, title },
          {
            stage: (stage) => progress.stage(stage),
            percent: (percent) => progress.stage("generating", percent),
          },
        );
        // The job's result is the WHOLE deck, not a summary of it: a client
        // that waited on this job renders what comes back, and a summary would
        // leave the player with nothing to speak until it fetched again.
        const bundle = await getNarrationBundle(dataLayer, {
          noteId,
          attachmentId,
          userId,
        });
        return narrationApiPayload(attachmentId, bundle.bundle);
      } catch (err) {
        // The row must say "failed" even though the throw is what refunds:
        // a student who comes back to the screen has to see why, not a
        // deck stuck at "writing".
        await markNarrationFailed(dataLayer, {
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
      if (!draftId || !dataLayer) {
        throw new Error("Study pack generation job requires draftId and supabase service");
      }
      // FIXED (F7a): the pack makes exactly one progress write of its own, and
      // everything after it — up to 8 note summaries, then flashcards, MCQs and
      // essays, each a chat completion with a 120 s timeout plus rate-limit
      // backoff — used to run silent, so the record went stale at 10 minutes and
      // the next poll terminalised and refunded a job that was still running.
      // `withJobHeartbeat` re-stamps the stage on an interval, which is what
      // `reconcileJobTimeout` measures, so the reconciler now sees a live job.
      await progress.stage("generating");
      progress.ref({ type: "studyPack", id: draftId, route: `/study-packs/drafts/${draftId}` });
      // Throws on total failure → the worker wrapper refunds the AI charge.
      return withJobHeartbeat(job, progress, "generating", () =>
        getStudyPackFactoryService(dataLayer).generate(draftId),
      );
    }
    default:
      throw new Error(`Unknown AI job: ${name}`);
  }
}

// ---------------------------------------------------------------------------
// file-processing queue
//
// Attachment and import work: APKG decks, presentation previews, YouTube
// transcripts and OCR. Binary input rides on the payload as base64, so these
// jobs are large — the worker runs at concurrency 1 by default.
// ---------------------------------------------------------------------------

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
    const importedDeck = await dataLayer.decks.importDeck(importData, userId);
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
    await runPresentationPreviewJob(dataLayer, {
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
    const result = await runYoutubeTranscriptJob(dataLayer, {
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
    const result = await runNoteOcrJob(dataLayer, {
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

// ---------------------------------------------------------------------------
// data-export queue
// ---------------------------------------------------------------------------

async function processExportJob(job: Job, progress: JobProgress): Promise<unknown> {
  if (job.name === "export.userData") {
    const { userId } = job.data as { userId: string };
    await progress.stage("generating");
    const archive = await dataLayer.users.exportUserData(userId);
    return { success: true, data: archive };
  }
  throw new Error(`Unknown export job: ${job.name}`);
}

// ---------------------------------------------------------------------------
// marketplace-alerts queue (repeatable cron)
//
// Scheduled platform work, not a student's request: these jobs have no userId
// and no charge, so the refund path is inert for them. Concurrency is 1, so a
// slow sweep delays the next tick rather than overlapping with itself.
// ---------------------------------------------------------------------------

async function processCronJob(job: Job, _progress: JobProgress): Promise<unknown> {
  if (job.name === "cron.dataRetention") {
    // Shared with in-process retention: AI log purges + overdue paused-account hard deletes.
    return runDataRetentionPurge(dataLayer);
  }
  if (job.name === "cron.marketplaceAlerts") {
    const saved = await processSavedSearchAlerts(dataLayer);
    const checkout = await processAbandonedCheckoutReminders(dataLayer);
    const offers = await processStaleOfferReminders(dataLayer);
    const reviews = await processReviewReminders(dataLayer);
    return { saved, checkout, offers, reviews };
  }
  if (job.name === "cron.jobAlerts") {
    const jobAlerts = await processJobSavedSearchAlerts(dataLayer);
    return { jobAlerts };
  }
  if (job.name === "cron.jobReminders") {
    return processJobDeadlineReminders(dataLayer);
  }
  if (job.name === "cron.studyReminders") {
    return processStudyReminders(dataLayer);
  }
  if (job.name === "cron.examReminders") {
    const { processExamReminders } = await import("../../services/examReminders");
    return processExamReminders(dataLayer);
  }
  if (job.name === "cron.weeklySummary") {
    return processWeeklySummary(dataLayer);
  }
  throw new Error(`Unknown cron job: ${job.name}`);
}

// ---------------------------------------------------------------------------
// The lifecycle wrapper, refunds, and worker startup
// ---------------------------------------------------------------------------

/**
 * Give every processor the same stage and credit contract: stamp `reading`
 * before it runs, `done` with its result and resultRef after, or `failed` plus
 * a refund if it throws.
 *
 * The error is rethrown after the record is written so BullMQ still sees the
 * job as failed — the record and the queue must not disagree.
 */
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
      const jobError = toJobError(err);
      // FIXED (F7a): jobs now carry real `attempts` (queue/enqueue.ts), so a
      // failure is not automatically the end. Stamping `failed` on a retryable
      // attempt would terminalise the record — and `advanceJobStage` refuses to
      // move a terminal record, so the retry that succeeded could never report
      // `done`. A non-final, retryable failure therefore leaves the record
      // alone; only the last attempt (or a permanent error) terminalises and
      // refunds.
      const permanent = !jobError.retryable;
      if (permanent || isFinalAttempt(job)) {
        await setJobStage(job.id!, "failed", { error: jobError });
        await refundChargeOnFinalFailure(job, { final: true }).catch((refundErr) => {
          console.error(`[queue] Credit refund failed for job ${job.id}:`, refundErr);
        });
      } else {
        console.warn(
          `[queue] Job ${job.id} attempt ${job.attemptsMade + 1}/${attemptsAllowed(job)} failed, retrying: ${jobError.message}`,
        );
      }
      // A permanent error must not spend the remaining attempts on an input
      // that will fail identically every time.
      if (permanent) {
        throw new UnrecoverableError(jobError.message);
      }
      throw err;
    }
  };
}

/** How many attempts BullMQ was told to make for this job (default 1). */
function attemptsAllowed(job: Job): number {
  const attempts = job.opts?.attempts;
  return typeof attempts === "number" && attempts > 0 ? attempts : 1;
}

/** Is this the last attempt BullMQ will make? */
function isFinalAttempt(job: Job): boolean {
  return job.attemptsMade + 1 >= attemptsAllowed(job);
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
async function refundChargeOnFinalFailure(
  job: Job,
  options: { final?: boolean } = {},
): Promise<void> {
  // FIXED (F7a): this guard is live now that `enqueueJob` passes real
  // `attempts` — a mid-cascade failure keeps the charge because the job is
  // going to run again. `final: true` is how the caller says it has already
  // decided this is the end (a permanent error on a non-final attempt).
  if (!options.final && !isFinalAttempt(job)) return;
  await refundJobCharge(job);
}

function envConcurrency(name: string, fallback: number, max = 32): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw) || raw < 1) return fallback;
  return Math.min(max, Math.floor(raw));
}

/**
 * Start one Worker per queue. Call after Redis is configured — each Worker
 * opens its own connection immediately.
 *
 * Concurrency is per queue and env-tunable within a hard ceiling, so a bad
 * value cannot open unbounded provider connections. The AI worker's default of
 * 2 sits beneath the provider concurrency gate in services/aiService.ts.
 */
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
      // FIXED (F7a): only on the FINAL attempt. A stall with retries left is
      // about to be picked up again, and terminalising the record here would
      // refuse the `done` that attempt writes.
      if (job?.id && (isFinalAttempt(job) || err instanceof UnrecoverableError)) {
        void setJobStage(job.id, "failed", { error: toJobError(err) }).catch(() => {});
        void refundChargeOnFinalFailure(job, { final: true }).catch((refundErr) => {
          console.error(`[queue] Credit refund failed for stalled job ${job.id}:`, refundErr);
        });
      }
    });
  }

  return [aiWorker, fileWorker, exportWorker, cronWorker];
}

/**
 * Register the repeatable platform jobs on the alerts queue.
 *
 * Each carries a fixed `jobId`, so re-running this on every boot replaces the
 * existing schedule rather than stacking a second copy. Changing a pattern or
 * interval without changing the `jobId` leaves the old repeat registered until
 * it is removed by hand.
 */
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
