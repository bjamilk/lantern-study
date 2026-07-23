import { useCallback, useEffect, useState } from 'react';
import {
  QUESTION_VISIBILITY_STORAGE_KEY,
  loadQuestionVisibilityMode,
  parseQuestionVisibilityMode,
  saveQuestionVisibilityMode,
  type QuestionVisibilityMode,
} from '@lantern/shared/utils';

/**
 * Persisted question visibility preference (web localStorage).
 * Same key as mobile AsyncStorage so the preference is shared conceptually.
 */
export function useQuestionVisibilityMode(): [
  QuestionVisibilityMode,
  (mode: QuestionVisibilityMode) => void,
] {
  const [mode, setModeState] = useState<QuestionVisibilityMode>(() =>
    typeof localStorage === 'undefined'
      ? 'all'
      : loadQuestionVisibilityMode((key) => localStorage.getItem(key))
  );

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== QUESTION_VISIBILITY_STORAGE_KEY) return;
      setModeState(parseQuestionVisibilityMode(event.newValue));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setMode = useCallback((next: QuestionVisibilityMode) => {
    setModeState(next);
    if (typeof localStorage !== 'undefined') {
      saveQuestionVisibilityMode((key, value) => localStorage.setItem(key, value), next);
    }
  }, []);

  return [mode, setMode];
}
