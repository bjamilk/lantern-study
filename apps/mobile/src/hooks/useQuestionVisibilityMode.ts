import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  QUESTION_VISIBILITY_STORAGE_KEY,
  parseQuestionVisibilityMode,
  type QuestionVisibilityMode,
} from '@lantern/shared/utils';

/**
 * Persisted question visibility preference (AsyncStorage).
 * Same key as web localStorage: `lantern.questionVisibilityMode`.
 */
export function useQuestionVisibilityMode(): [
  QuestionVisibilityMode,
  (mode: QuestionVisibilityMode) => void,
] {
  const [mode, setModeState] = useState<QuestionVisibilityMode>('all');

  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(QUESTION_VISIBILITY_STORAGE_KEY)
      .then((raw) => {
        if (!cancelled) setModeState(parseQuestionVisibilityMode(raw));
      })
      .catch(() => {
        /* keep default */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setMode = useCallback((next: QuestionVisibilityMode) => {
    setModeState(next);
    void AsyncStorage.setItem(QUESTION_VISIBILITY_STORAGE_KEY, next).catch(() => {});
  }, []);

  return [mode, setMode];
}
