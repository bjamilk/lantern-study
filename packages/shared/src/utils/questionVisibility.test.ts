import { MessageType, QuestionStatus } from '../types';
import {
  isUnverifiedQuestion,
  messagePassesQuestionVisibility,
  parseQuestionVisibilityMode,
} from './questionVisibility';

describe('questionVisibility', () => {
  it('parses known modes and defaults unknown to all', () => {
    expect(parseQuestionVisibilityMode('verified')).toBe('verified');
    expect(parseQuestionVisibilityMode('nope')).toBe('all');
    expect(parseQuestionVisibilityMode(null)).toBe('all');
  });

  it('treats missing status as unverified', () => {
    expect(isUnverifiedQuestion(undefined)).toBe(true);
    expect(isUnverifiedQuestion(QuestionStatus.PENDING)).toBe(true);
    expect(isUnverifiedQuestion(QuestionStatus.VERIFIED)).toBe(false);
  });

  it('never filters non-question messages', () => {
    const text = { type: MessageType.TEXT };
    expect(messagePassesQuestionVisibility(text, 'none')).toBe(true);
    expect(messagePassesQuestionVisibility(text, 'verified')).toBe(true);
  });

  it('auto-hides verified questions in unverified-only mode', () => {
    const pending = { type: MessageType.QUESTION, questionStatus: QuestionStatus.PENDING };
    const verified = { type: MessageType.QUESTION, questionStatus: QuestionStatus.VERIFIED };
    expect(messagePassesQuestionVisibility(pending, 'unverified')).toBe(true);
    expect(messagePassesQuestionVisibility(verified, 'unverified')).toBe(false);
    expect(messagePassesQuestionVisibility(verified, 'verified')).toBe(true);
  });

  it('keeps pending questions visible in chat under verified mode so members can vote', () => {
    const pending = { type: MessageType.QUESTION, questionStatus: QuestionStatus.PENDING };
    const rejected = { type: MessageType.QUESTION, questionStatus: QuestionStatus.REJECTED };
    const missingStatus = { type: MessageType.QUESTION };
    expect(messagePassesQuestionVisibility(pending, 'verified')).toBe(true);
    expect(messagePassesQuestionVisibility(missingStatus, 'verified')).toBe(true);
    expect(messagePassesQuestionVisibility(rejected, 'verified')).toBe(false);
    expect(messagePassesQuestionVisibility(pending, 'none')).toBe(false);
  });
});
