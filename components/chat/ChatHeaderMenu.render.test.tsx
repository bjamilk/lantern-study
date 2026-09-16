/**
 * Render smoke test for the header's overflow menu (lane M8, step 1).
 *
 * The menu is where the group/DM split is widest and where `communityHost`
 * removes the most, so the test renders each of those shapes and asserts which
 * items the component decides to render. `renderToStaticMarkup`: no effect runs
 * and nothing is fetched. Open/closed is NOT what is under test here — the
 * stubbed primitives below render their children either way.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ChatHeaderMenu, type ChatHeaderMenuProps } from './ChatHeaderMenu';

/**
 * `MenuContent` portals through `createPortal`, which `renderToStaticMarkup`
 * drops, so the real primitives would render an open menu as an empty trigger.
 * They are replaced with plain elements that render their children, which is
 * exactly the question this test asks: given this conversation, WHICH items
 * does the component decide to render? Menu behaviour itself belongs to
 * `components/ui/Menu.tsx` and is not retested here.
 */
vi.mock('../ui', () => ({
  Menu: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  MenuTrigger: ({ children, ...rest }: Record<string, unknown>) => (
    <button {...rest}>{children as React.ReactNode}</button>
  ),
  MenuContent: ({ children }: { children?: React.ReactNode }) => <div role="menu">{children}</div>,
  MenuItem: ({ children, disabled }: { children?: React.ReactNode; disabled?: boolean }) => (
    <button type="button" disabled={disabled}>
      {children}
    </button>
  ),
  MenuSubmenu: ({ label, children }: { label?: string; children?: React.ReactNode }) => (
    <div>
      <span>{label}</span>
      {children}
    </div>
  ),
  MenuSeparator: () => <hr />,
}));

const noop = () => {};

const baseProps: ChatHeaderMenuProps = {
  chat: { id: 'g1', chatType: 'group', name: 'Pharmacology 301' } as never,
  group: { id: 'g1', name: 'Pharmacology 301', members: [] } as never,
  isGroup: true,
  isGroupAdmin: false,
  isArchived: false,
  communityHost: false,
  name: 'Pharmacology 301',
  dmPeerId: undefined,
  isDropdownOpen: true,
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

const dmProps: Partial<ChatHeaderMenuProps> = {
  chat: { id: 't1', chatType: 'dm', name: 'Ada' } as never,
  group: null,
  isGroup: false,
  name: 'Ada Ogundele',
  dmPeerId: 'u2',
  onDeleteDmThread: noop,
};

const render = (props: Partial<ChatHeaderMenuProps> = {}) =>
  renderToStaticMarkup(<ChatHeaderMenu {...baseProps} {...props} />);

describe('ChatHeaderMenu', () => {
  it('renders the ⋮ trigger', () => {
    expect(render()).toContain('aria-label="Chat options"');
  });

  it('gives a group the study apparatus and the archive action', () => {
    const html = render();
    expect(html).toContain('Group Info &amp; Members');
    expect(html).toContain('Create Sub-group');
    expect(html).toContain('All questions');
    expect(html).toContain('Archive Group');
    // Test/Study live here only for the widths where the toolbar hides them.
    expect(html).toContain('Take a Test');
  });

  it('offers AI generation only to a group admin whose shell supplied the modal', () => {
    expect(render()).not.toContain('AI Generate Questions');
    expect(render({ isGroupAdmin: true })).not.toContain('AI Generate Questions');
    expect(render({ isGroupAdmin: true, onOpenAIGenerateModal: noop })).toContain(
      'AI Generate Questions'
    );
  });

  it('strips the study apparatus and archiving from a community chat', () => {
    const html = render({ communityHost: true });
    expect(html).not.toContain('Create Sub-group');
    expect(html).not.toContain('All questions');
    expect(html).not.toContain('Archive Group');
    // What a member keeps: search, starred, photos, group info, mute.
    expect(html).toContain('Group Info &amp; Members');
    expect(html).toContain('Mute');
  });

  it('offers only unarchiving once the group is archived', () => {
    const html = render({ isArchived: true });
    expect(html).toContain('Unarchive Group');
    expect(html).not.toContain('Create Sub-group');
  });

  it('gives a DM block, report and delete instead', () => {
    const html = render(dmProps);
    expect(html).toContain('Block User');
    expect(html).toContain('Report User…');
    expect(html).toContain('Delete Conversation');
    expect(html).not.toContain('Group Info');
  });

  it('flips Block to Unblock when the viewer is the one blocking', () => {
    expect(render({ ...dmProps, iBlockedThem: true })).toContain('Unblock User');
  });

  it('offers the mute durations while unmuted and Unmute while muted', () => {
    expect(render()).toContain('Mute');
    const html = render({ chatMuted: true, muteUntilLabel: 'tomorrow 09:00' });
    expect(html).toContain('Unmute (until tomorrow 09:00)');
  });
});
