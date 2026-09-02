import { describe, expect, it } from 'vitest';
import { AppMode } from '../types';
import { resolveSideColumn } from './sideColumn';

const community = { slug: 'unilag-med' };

describe('resolveSideColumn', () => {
  it('shows the community column on the community page and in its rooms', () => {
    expect(
      resolveSideColumn({ isChatsSectionExpanded: true, appMode: AppMode.COMMUNITY_DETAIL, activeCommunity: community })
    ).toBe('community');
    expect(
      resolveSideColumn({ isChatsSectionExpanded: false, appMode: AppMode.STUDY_ROOM, activeCommunity: community })
    ).toBe('community');
  });

  it('never shows the community column without an active community', () => {
    expect(
      resolveSideColumn({ isChatsSectionExpanded: true, appMode: AppMode.COMMUNITY_DETAIL, activeCommunity: null })
    ).toBe('chats');
    expect(
      resolveSideColumn({ isChatsSectionExpanded: false, appMode: AppMode.STUDY_ROOM, activeCommunity: null })
    ).toBeNull();
  });

  it('keeps the chats flyout everywhere but the chat screen', () => {
    expect(
      resolveSideColumn({ isChatsSectionExpanded: true, appMode: AppMode.DASHBOARD, activeCommunity: null })
    ).toBe('chats');
    expect(
      resolveSideColumn({ isChatsSectionExpanded: true, appMode: AppMode.CHAT, activeCommunity: null })
    ).toBeNull();
  });

  it('an active community off its own modes falls back to the chats rule', () => {
    expect(
      resolveSideColumn({ isChatsSectionExpanded: true, appMode: AppMode.DASHBOARD, activeCommunity: community })
    ).toBe('chats');
    expect(
      resolveSideColumn({ isChatsSectionExpanded: false, appMode: AppMode.DASHBOARD, activeCommunity: community })
    ).toBeNull();
  });
});
