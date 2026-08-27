import React, { useEffect } from 'react';
import { FeatureTipSheet } from './FeatureTipSheet';
import { useFeatureTipStore } from '../../stores/featureTipStore';
import { useSettingsStore } from '../../stores/settingsStore';
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
    setTipReady('nav.companion', moreOpen || companionOpen || activeTab === 'AI' || activeTab === 'More');
    setTipReady('library.tabs', isLibrary || activeTab === 'Library');
    setTipReady('chat.question', isGroupChat);
    setTipReady('chat.test', isGroupChat);
    setTipReady('chat.study', isGroupChat);
    setTipReady('chat.summarize', false);
    setTipReady('chat.aiGenerate', isGroupChat);
    setTipAllowed('chat.aiGenerate', isGroupAdmin);

    setTipReady('nav.marketplace', activeTab === 'Marketplace' || moreOpen);
    setTipReady('nav.budget', activeTab === 'Budget' || moreOpen);
    setTipReady('nav.offline', activeTab === 'Offline' || moreOpen);

    if (isLibrary || activeTab === 'Library') markChecklist('openLibrary');
    if (companionOpen || activeTab === 'AI') markChecklist('tryCompanion');
    if (activeTab === 'Marketplace') markChecklist('exploreMarketplace');
    if (activeTab === 'Offline') markChecklist('tryOffline');
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
