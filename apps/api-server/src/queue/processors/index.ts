import { Worker, type Job } from "bullmq";
import { getQueueConnectionOptions } from "../connection";
import { QUEUE_NAMES } from "../jobs/types";
import { updateJobStatus } from "../jobStatus";
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
import { logAIInference } from "../../services/aiInferenceLog";
import { buildTrustedCompanionContext } from "../../services/companionContext";
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

async function processAiJob(job: Job): Promise<unknown> {
  const userId = job.data.userId as string | undefined;
  const name = job.name;

  switch (name) {
    case "ai.generate.questions": {
      const { notes, count, difficulty, questionTypes, subject } = job.data;
      const result = await generateQuestionsFromNotes(notes, {
        count,
        difficulty,
        questionTypes,
        subject,
      });
      await recordInference(userId, "generate-questions", result);
      return result;
    }
    case "ai.generate.flashcards": {
      const { notes, count, style } = job.data;
      const result = await generateFlashcardsFromNotes(notes, { count, style });
      await recordInference(userId, "generate-flashcards", result);
      return result;
    }
    case "ai.explain.answer": {
      const { question, userAnswer, correctAnswer, options } = job.data;
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
      const result = await getStudyRecommendations(job.data.performanceData);
      await recordInference(userId, "study-recommendations", result);
      return result;
    }
    case "ai.ask.tutor": {
      const { question, context } = job.data;
      const result = await askTutor(question, context);
      await recordInference(userId, "ask-tutor", result);
      return result;
    }
    case "ai.enhance.flashcard": {
      const { front, back } = job.data;
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
      const { reply, actions, provider } = await companionChat(
        trimmed,
        history,
        { ...trustedContext, noteId: effectiveNoteId || undefined },
      );
      await recordInference(userId, "companion-message", { provider });

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
      const { content, title, noteId, sourceType } = job.data as {
        content: string;
        title?: string;
        noteId?: string;
        sourceType?: string;
      };
      const result = await summarizeNoteContent(content, { title, sourceType });
      await recordInference(userId, "summarize-note", result);
      if (noteId && userId && supabaseService) {
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
      const result = await generateDailyQuiz(content, { studyGoal, count });
      await recordInference(userId, "note-quiz", result);
      if (noteId && userId && supabaseService) {
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
        return session;
      }
      return result;
    }
    case "notes.ai.flashcards": {
      const { content, count, style } = job.data as {
        content: string;
        count?: number;
        style?: string;
      };
      const result = await generateFlashcardsFromNotes(content, {
        count,
        style: style as "concise" | "detailed" | undefined,
      });
      await recordInference(userId, "note-flashcards", result);
      return result;
    }
    default:
      throw new Error(`Unknown AI job: ${name}`);
  }
}

async function processFileJob(job: Job): Promise<unknown> {
  if (job.name === "deck.importApkg") {
    const { apkgBase64, userId } = job.data as {
      apkgBase64: string;
      userId: string;
    };
    const buffer = Buffer.from(apkgBase64, "base64");
    const importData = await parseApkgBuffer(buffer);
    const importedDeck = await supabaseService.importDeck(importData, userId);
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
      sourceKind: "pdf" | "presentation" | "preview_pdf";
      meta?: Record<string, unknown>;
      bufferBase64?: string;
    };
    const result = await runNoteOcrJob(supabaseService, {
      noteId,
      attachmentId,
      storagePath,
      fileName,
      sourceKind,
      meta: meta || {},
      buffer: bufferBase64 ? Buffer.from(bufferBase64, "base64") : undefined,
    });
    return { success: result.status === "ok", ...result };
  }
  throw new Error(`Unknown file job: ${job.name}`);
}

async function processExportJob(job: Job): Promise<unknown> {
  if (job.name === "export.userData") {
    const { userId } = job.data as { userId: string };
    const archive = await supabaseService.exportUserData(userId);
    return { success: true, data: archive };
  }
  throw new Error(`Unknown export job: ${job.name}`);
}

async function processCronJob(job: Job): Promise<unknown> {
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
  throw new Error(`Unknown cron job: ${job.name}`);
}

function wrapProcessor(processor: (job: Job) => Promise<unknown>) {
  return async (job: Job) => {
    await updateJobStatus(job.id!, "active");
    try {
      const result = await processor(job);
      await updateJobStatus(job.id!, "completed", { result });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await updateJobStatus(job.id!, "failed", { error: message });
      throw err;
    }
  };
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
}
