import React, { useEffect } from 'react';
import { FeatureTipSheet } from './FeatureTipSheet';
import { useFeatureTipStore } from '../../stores/featureTipStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useMarketplaceStore } from '../../stores/marketplaceStore';
import type { TabKey } from '../layout/BottomTabBar';

interface FeatureTipsHostProps {
  onboardingComplete: boolean;
  activeTab: TabKey;
  isGroupChat?: boolean;
  isLibrary?: boolean;
  isGroupAdmin?: boolean;
  moreOpen?: boolean;
  companionOpen?: boolean;
}

/**
 * Mount near the root navigator. Sets tip readiness from navigation + renders active tip sheet.
 */
export function FeatureTipsHost({
  onboardingComplete,
  activeTab,
  isGroupChat = false,
  isLibrary = false,
  isGroupAdmin = false,
  moreOpen = false,
  companionOpen = false,
}: FeatureTipsHostProps) {
  const hydrate = useFeatureTipStore((s) => s.hydrate);
  const syncFromUserSettings = useFeatureTipStore((s) => s.syncFromUserSettings);
  const setOnboardingComplete = useFeatureTipStore((s) => s.setOnboardingComplete);
  const setTipReady = useFeatureTipStore((s) => s.setTipReady);
  const setTipAllowed = useFeatureTipStore((s) => s.setTipAllowed);
  const activeTipId = useFeatureTipStore((s) => s.activeTipId);
  const markChecklist = useFeatureTipStore((s) => s.markChecklist);
  const featureTips = useSettingsStore((s) => s.settings.featureTips);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    setOnboardingComplete(onboardingComplete);
  }, [onboardingComplete, setOnboardingComplete]);

  useEffect(() => {
    if (featureTips) syncFromUserSettings(featureTips);
  }, [featureTips, syncFromUserSettings]);

  useEffect(() => {
    setTipReady('nav.library', true);
    setTipReady('nav.chat', true);
    // Re-keyed for the five destinations (2026-09-04): the 'More' drawer and
    // the Library/Marketplace/Budget/Offline tabs no longer exist. Study is
    // where the library lives; Campus holds the Shop; Budget and Downloads are
    // rows inside Me.
    setTipReady('nav.companion', moreOpen || companionOpen || activeTab === 'AI');
    setTipReady('library.tabs', isLibrary || activeTab === 'Study');
    setTipReady('chat.question', isGroupChat);
    setTipReady('chat.test', isGroupChat);
    setTipReady('chat.study', isGroupChat);
    setTipReady('chat.summarize', false);
    setTipReady('chat.aiGenerate', isGroupChat);
    setTipAllowed('chat.aiGenerate', isGroupAdmin);

    // The Shop is open to every account (2026-09-15), so the tip no longer
    // needs an access answer before it may coach anyone.
    setTipReady('nav.marketplace', activeTab === 'Campus' || moreOpen);
    // Budget and Downloads are both rows on Me, so Me is where each tip has
    // something to point at.
    setTipReady('nav.budget', activeTab === 'Me' || moreOpen);
    setTipReady('nav.offline', activeTab === 'Me' || moreOpen);

    if (isLibrary || activeTab === 'Study') markChecklist('openLibrary');
    if (companionOpen || activeTab === 'AI') markChecklist('tryCompanion');
    if (activeTab === 'Campus') markChecklist('exploreMarketplace');
    // 'tryOffline' no longer has a tab to watch: Downloads is a screen behind
    // a row on Me, and ticking it the moment Me opens would claim the student
    // did something they did not. It needs re-keying to the Downloads screen
    // itself, which this wave does not own.
  }, [
    activeTab,
    isGroupChat,
    isLibrary,
    isGroupAdmin,
    moreOpen,
    companionOpen,
    setTipReady,
    setTipAllowed,
    markChecklist,
  ]);

  // Keep companion tip discoverable from More tab even when sheet closed
  useEffect(() => {
    setTipReady('nav.companion', true);
  }, [setTipReady]);

  return <FeatureTipSheet tipId={activeTipId} />;
}

export default FeatureTipsHost;
