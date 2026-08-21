import React, { useEffect } from 'react';
import { FeatureTip } from './FeatureTip';
import { useFeatureTipStore } from '../../stores/featureTipStore';
import type { FeatureTipId } from '@lantern/shared/featureTips';
import { normalizeUserSettings } from '@lantern/shared/settings';

const ALL_TIP_IDS: FeatureTipId[] = [
  'nav.library',
  'library.tabs',
  'flashcards.deckModes',
  'flashcards.grading',
  'nav.companion',
  'nav.chat',
  'chat.question',
  'chat.test',
  'chat.study',
  'chat.summarize',
  'chat.aiGenerate',
  'nav.budget',
  'nav.marketplace',
  'nav.offline',
];

interface FeatureTipsHostProps {
  onboardingComplete: boolean;
  /** Current app mode / route hints */
  appMode?: string;
  isGroupChat?: boolean;
  isLibrary?: boolean;
  isAdmin?: boolean;
  userSettings?: unknown;
  reduceMotion?: boolean;
}

/**
 * Mount once near the app shell. Renders the active coach tip and hydrates progress.
 */
export const FeatureTipsHost: React.FC<FeatureTipsHostProps> = ({
  onboardingComplete,
  appMode,
  isGroupChat = false,
  isLibrary = false,
  isAdmin = false,
  userSettings,
  reduceMotion = false,
}) => {
  const hydrate = useFeatureTipStore((s) => s.hydrate);
  const syncFromUserSettings = useFeatureTipStore((s) => s.syncFromUserSettings);
  const setOnboardingComplete = useFeatureTipStore((s) => s.setOnboardingComplete);
  const setTipReady = useFeatureTipStore((s) => s.setTipReady);
  const setTipAllowed = useFeatureTipStore((s) => s.setTipAllowed);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    setOnboardingComplete(onboardingComplete);
  }, [onboardingComplete, setOnboardingComplete]);

  useEffect(() => {
    if (userSettings) syncFromUserSettings(userSettings);
  }, [userSettings, syncFromUserSettings]);

  // Surface readiness from app mode + DOM anchors
  useEffect(() => {
    const mode = (appMode || '').toUpperCase();
    setTipReady('library.tabs', mode === 'LIBRARY' || isLibrary);
    setTipReady('chat.question', isGroupChat);
    setTipReady('chat.test', isGroupChat);
    setTipReady('chat.study', isGroupChat);
    setTipReady('chat.summarize', isGroupChat);
    setTipReady('chat.aiGenerate', isGroupChat);
    setTipAllowed('chat.aiGenerate', isAdmin);

    // Budget / marketplace / offline tips when those modes are open (or anchors present)
    if (mode === 'BUDGET') setTipReady('nav.budget', true);
    if (mode === 'MARKETPLACE' || mode === 'EXPLORE') setTipReady('nav.marketplace', true);
    if (mode === 'OFFLINE') setTipReady('nav.offline', true);
  }, [appMode, isGroupChat, isLibrary, isAdmin, setTipReady, setTipAllowed]);

  // Mark nav tips ready when their anchors exist in the DOM
  useEffect(() => {
    const check = () => {
      const navIds: FeatureTipId[] = [
        'nav.library',
        'nav.chat',
        'nav.companion',
        'nav.budget',
        'nav.marketplace',
        'nav.offline',
        'library.tabs',
        'chat.question',
        'chat.test',
        'chat.study',
        'chat.summarize',
        'chat.aiGenerate',
      ];
      for (const id of navIds) {
        if (document.querySelector(`[data-tip-id="${id}"]`)) {
          setTipReady(id, true);
        }
      }
    };
    check();
    const t = window.setInterval(check, 1200);
    return () => window.clearInterval(t);
  }, [setTipReady, appMode, isGroupChat, isLibrary]);

  const settings = userSettings ? normalizeUserSettings(userSettings) : null;
  const reduce =
    reduceMotion || Boolean(settings?.accessibility?.reduceMotion);

  return (
    <>
      {ALL_TIP_IDS.map((id) => (
        <FeatureTip key={id} tipId={id} reduceMotion={reduce} />
      ))}
    </>
  );
};

export default FeatureTipsHost;
