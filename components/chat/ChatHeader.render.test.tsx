/**
 * Render smoke test for the header extracted out of ChatWindow (lane M8, step 1).
 *
 * The header is where the two conversation kinds diverge most: a group gets the
 * Question/Test/Study toolbar and the group overflow menu, a DM gets neither and
 * a different menu entirely. Those two branches, plus the three subtitle forms
 * (archived / in-a-community / plain) and the muted strip, are the whole of what
 * this component decides — so they are what it is tested on.
 *
 * `renderToStaticMarkup`, like the other render tests in this repo: no effect
 * runs, nothing is fetched. Menus render their trigger but not their content
 * (they are closed), which is why the assertions below are about the toolbar,
 * the subtitle and the strip rather than about menu items.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChatHeader, type ChatHeaderProps } from './ChatHeader';

const noop = () => {};

const baseProps: ChatHeaderProps = {
  chat: { id: 'g1', chatType: 'group', name: 'Pharmacology 301' } as never,
  group: { id: 'g1', name: 'Pharmacology 301', members: [] } as never,
  isGroup: true,
  isGroupAdmin: false,
  isArchived: false,
  communityHost: false,
  name: 'Pharmacology 301',
  avatarUrl: null,
  description: '12 members',
  memberCountText: '12 members',
  dmPeerId: undefined,
  lowDataMode: false,
  resolvedPeerPresence: null,
  communityContext: undefined,
  visibleMessages: [],
  onBack: undefined,
  isDropdownOpen: false,
  setIsDropdownOpen: noop,
  questionFiltersOpen: false,
  setQuestionFiltersOpen: noop,
  questionVisibilityMode: 'all',
  setQuestionVisibilityMode: noop,
  starredOnly: false,
  setStarredOnly: noop,
  starredIds: new Set<string>(),
  setGalleryOpen: noop,
  setThreadSearchOpen: noop,
  setReportTarget: noop,
  chatMuted: false,
  muteBusy: false,
  muteUntilLabel: null,
  muteDurationsOpen: false,
  setMuteDurationsOpen: noop,
  handleMuteFor: noop,
  handleUnmute: noop,
  onOpenQuestionModal: noop,
  onOpenTestConfigModal: noop,
  onOpenStudyConfigModal: noop,
  onOpenGroupInfoModal: noop,
  onOpenCreateSubGroupModal: noop,
  onOpenAIGenerateModal: undefined,
  onToggleArchiveGroup: noop,
  onArchiveDmThread: undefined,
  onUnarchiveDmThread: undefined,
  onDeleteDmThread: undefined,
  handleToggleDmBlock: noop,
  iBlockedThem: false,
};

const render = (props: Partial<ChatHeaderProps> = {}) =>
  renderToStaticMarkup(<ChatHeader {...baseProps} {...props} />);

describe('ChatHeader', () => {
  it('shows the conversation name, its subtitle and the two always-on controls', () => {
    const html = render();
    expect(html).toContain('Pharmacology 301');
    expect(html).toContain('12 members');
    expect(html).toContain('aria-label="Search in chat"');
    expect(html).toContain('aria-label="Chat options"');
  });

  it('gives a group the study toolbar', () => {
    const html = render();
    expect(html).toContain('aria-label="Submit question"');
    expect(html).toContain('aria-label="Take a test"');
    expect(html).toContain('aria-label="Study mode"');
  });

  it('gives a DM none of it', () => {
    const html = render({
      chat: { id: 't1', chatType: 'dm', name: 'Ada' } as never,
      group: null,
      isGroup: false,
      isGroupAdmin: false,
      name: 'Ada Ogundele',
      description: 'Active 2h ago',
      memberCountText: '',
      dmPeerId: 'u2',
    });
    expect(html).toContain('Ada Ogundele');
    expect(html).not.toContain('aria-label="Submit question"');
    expect(html).not.toContain('aria-label="Take a test"');
  });

  it('drops the toolbar for a community chat, which has no study apparatus', () => {
    const html = render({ communityHost: true });
    expect(html).not.toContain('aria-label="Submit question"');
  });

  it('drops the toolbar for an archived group and says so', () => {
    const html = render({ isArchived: true });
    expect(html).toContain('Archived');
    expect(html).not.toContain('aria-label="Submit question"');
  });

  it('folds the question count into the subtitle', () => {
    const html = render({
      visibleMessages: [
        { id: 'm1', questionType: 'mcq' },
        { id: 'm2' },
        { id: 'm3', questionType: 'mcq' },
      ] as never,
    });
    expect(html).toContain('12 members · 2 questions');
  });

  it('links to the community instead, when the group is a community channel', () => {
    const html = render({
      communityContext: { name: 'Unilag Pharmacy', onOpen: noop },
    });
    expect(html).toContain('aria-label="Open community"');
    expect(html).toContain('Unilag Pharmacy');
  });

  it('shows the muted strip with its unmute button only while muted', () => {
    expect(render()).not.toContain('Notifications muted');
    const html = render({ chatMuted: true, muteUntilLabel: 'tomorrow 09:00' });
    expect(html).toContain('Notifications muted until tomorrow 09:00');
    expect(html).toContain('Unmute');
  });

  it('shows the back button only when the shell supplies a way back', () => {
    expect(render()).not.toContain('aria-label="Back to chats"');
    expect(render({ onBack: noop })).toContain('aria-label="Back to chats"');
    expect(render({ onBack: noop, communityContext: { name: 'Unilag', onOpen: noop } })).toContain(
      'aria-label="Back to community"'
    );
  });
});
