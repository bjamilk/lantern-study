/**
 * The queued companion path must return the SAME payload shape as the
 * synchronous handler in routes/aiCompanion.ts. In production BullMQ is on, so
 * the worker — not the sync handler — answers the JSON route the mobile client
 * uses; a field dropped here is a field mobile never sees (citations chips).
 */
import type { Job } from 'bullmq';

jest.mock('../services/aiService', () => ({
  companionChat: jest.fn(),
}));
jest.mock('../services/companionContext', () => ({
  buildTrustedCompanionContext: jest.fn(async () => ({ noteId: null })),
}));
jest.mock('../services/companionConversations', () => ({
  ensureConversationTitle: jest.fn(async () => undefined),
  parseCompanionUuid: jest.fn((v: unknown) => (typeof v === 'string' ? v : null)),
  resolveConversationForSend: jest.fn(async () => ({
    id: 'conv-1',
    note_context_id: null,
  })),
  touchConversation: jest.fn(async () => undefined),
}));
jest.mock('../services/aiInferenceLog', () => ({
  logAIInference: jest.fn(async () => undefined),
}));
jest.mock('./jobStatus', () => ({
  setJobStage: jest.fn(async () => undefined),
  getJobRecord: jest.fn(async () => null),
  refundJobCreditOnce: jest.fn(async () => undefined),
}));

import { companionChat } from '../services/aiService';
import { initializeWorkerServices, processAiJob, type JobProgress } from './processors';

const chatMock = companionChat as jest.MockedFunction<any>;

function stubClient() {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: async () => ({ data: [] }),
    insert: async () => ({ error: null }),
  };
  return { from: () => chain };
}

const progress: JobProgress = {
  stage: jest.fn(async () => undefined),
  ref: jest.fn(),
} as unknown as JobProgress;

function companionJob(): Job {
  return {
    name: 'ai.companion.message',
    data: { userId: 'user-1', message: 'What does the Act say?' },
  } as unknown as Job;
}

describe('queued companion message result shape', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    initializeWorkerServices({ getClient: () => stubClient() } as any);
  });

  it('carries citations through to the job result unchanged', async () => {
    const citations = [
      { noteId: 'note-1', excerpt: 'Land is vested in the Governor', position: 1 },
    ];
    chatMock.mockResolvedValue({
      reply: 'Here is the answer.',
      actions: [],
      provider: 'anthropic',
      citations,
    });

    const result = (await processAiJob(companionJob(), progress)) as any;

    expect(result.citations).toEqual(citations);
    expect(result.citations).toBe(citations);
    expect(result).toEqual({
      reply: 'Here is the answer.',
      actions: [],
      provider: 'anthropic',
      citations,
      conversationId: 'conv-1',
    });
  });

  it('keeps a null citations null rather than dropping the key', async () => {
    chatMock.mockResolvedValue({
      reply: 'No note in context.',
      actions: [],
      provider: 'anthropic',
      citations: null,
    });

    const result = (await processAiJob(companionJob(), progress)) as any;

    expect(result).toHaveProperty('citations', null);
  });

  it('normalises an absent citations field to null, like the sync handler', async () => {
    chatMock.mockResolvedValue({
      reply: 'Ungrounded reply.',
      actions: [],
      provider: 'anthropic',
    });

    const result = (await processAiJob(companionJob(), progress)) as any;

    expect(result).toHaveProperty('citations', null);
  });
});
