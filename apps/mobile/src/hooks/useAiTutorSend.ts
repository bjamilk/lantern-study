import { useCallback, useState } from 'react';
import { appAlert } from '../components/ui/appDialog';
import { formatAiTutorReply, parseAiQuery } from '@lantern/shared/utils';
import { aiAskTutor } from '../services/ai';

/**
 * `'not-a-query'` — ordinary text, the caller should send it normally.
 * `'answered'`    — the tutor replied and the answer was posted.
 * `'failed'`      — it was a tutor query but produced nothing; the caller should
 *                   restore whatever it cleared from the composer.
 */
export type AiTutorSendResult = 'not-a-query' | 'answered' | 'failed';

interface UseAiTutorSendOptions {
  /**
   * Post the tutor's formatted answer into the conversation — whatever the
   * caller's normal send path is: group send, DM send, thread reply.
   */
  onPostAnswer: (text: string) => Promise<void>;
}

/**
 * Handles the in-chat "@AI …" / "/ask …" trigger.
 *
 * Extracted from GroupChatScreen, which owned the only copy — which is why the
 * same text typed into a thread posted verbatim as a plain message instead of
 * reaching the tutor.
 *
 * Composer state stays with the caller: it varies (voice-note sends pass
 * override text and must not clear the box), and getting it wrong loses the
 * user's question.
 */
export function useAiTutorSend({ onPostAnswer }: UseAiTutorSendOptions) {
  const [aiThinking, setAiThinking] = useState(false);

  const trySend = useCallback(
    async (text: string): Promise<AiTutorSendResult> => {
      const question = parseAiQuery(text);
      if (!question) return 'not-a-query';

      setAiThinking(true);
      try {
        const { answer } = await aiAskTutor(question);
        if (!answer) {
          // A 200 with an empty answer (quota exhausted, provider returned
          // nothing) used to swallow the question along with the composer text.
          appAlert('No answer', 'The AI Tutor did not return an answer. Please try again.');
          return 'failed';
        }
        await onPostAnswer(formatAiTutorReply(answer));
        return 'answered';
      } catch (error) {
        appAlert(
          'AI Tutor failed',
          error instanceof Error ? error.message : 'Please try again.'
        );
        return 'failed';
      } finally {
        setAiThinking(false);
      }
    },
    [onPostAnswer]
  );

  return { trySend, aiThinking };
}
