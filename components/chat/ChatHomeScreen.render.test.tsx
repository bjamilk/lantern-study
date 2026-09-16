/**
 * Render smoke test for the chat home screen (lane M8b, step 3).
 *
 * This screen is two layouts of the same data, and the thing worth pinning is
 * the routing of conversations between its sections, not its markup:
 *
 *  - an inbound message REQUEST is not an ordinary DM. It belongs in its own
 *    labelled section and must not also appear in the active list, or the
 *    reader sees the same person twice with two different meanings.
 *  - a request YOU sent is an ordinary DM, because you already consented to it.
 *  - archived groups and archived DMs share one "Archived" section, counted
 *    together.
 *  - with nothing at all, both layouts fall back to the same `ChatHomePane`.
 *
 * `ChatHomePane` and `GroupListItem` are stubbed: both have their own coverage
 * and what this file is asking is which section each conversation lands in.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ChatHomeScreen, type ChatHomeScreenProps } from './ChatHomeScreen';

vi.mock('./ChatHomePane', () => ({
  ChatHomePane: (props: Record<string, unknown>) => (
    <div data-testid="home-pane" data-compact={String(!!props.compact)} />
  ),
}));
vi.mock('../GroupListItem', () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="row" data-id={String((props.chat as { id: string }).id)} />
  ),
}));

const noop = () => {};

const currentUser = { id: 'u1', name: 'Ada Ogundele' } as never;

const dm = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, participantIds: ['u1', 'u2'], participants: {}, ...extra }) as never;

const group = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, name: id, members: [], ...extra }) as never;

const baseProps: ChatHomeScreenProps = {
  currentUser,
  groups: [],
  dmThreads: [],
  communities: [],
  inquiries: [],
  expandedParentGroups: {},
  setExpandedParentGroups: noop,
  onSelectChat: noop,
  onCreateGroup: noop,
  onOpenNewDmModal: noop,
  onOpenLounge: noop,
  onOpenInquiries: noop,
};

const render = (props: Partial<ChatHomeScreenProps> = {}) =>
  renderToStaticMarkup(<ChatHomeScreen {...baseProps} {...props} />);

const ids = (html: string) =>
  [...html.matchAll(/data-testid="row" data-id="([^"]+)"/g)].map((m) => m[1]);

describe('ChatHomeScreen', () => {
  it('falls back to the home pane on both layouts when there is nothing', () => {
    const html = render();
    // Desktop placeholder plus the mobile empty state, the latter compact.
    expect((html.match(/data-testid="home-pane"/g) || []).length).toBe(2);
    expect(html).toContain('data-compact="true"');
    expect(ids(html)).toEqual([]);
  });

  it('offers both ways to start a conversation on the mobile header', () => {
    const html = render();
    expect(html).toContain('Chats');
    expect(html).toContain('title="New message"');
    expect(html).toContain('title="New group"');
  });

  it('puts an inbound request in its own section, and not in the active list', () => {
    const html = render({
      dmThreads: [dm('inbound', { status: 'pending', requestedBy: 'u2' }), dm('open')],
    });
    expect(html).toContain('Message requests (1)');
    // One row each: the request above, the ordinary DM below. Not three.
    expect(ids(html)).toEqual(['inbound', 'open']);
  });

  it('treats a request YOU sent as an ordinary DM', () => {
    const html = render({
      dmThreads: [dm('outbound', { status: 'pending', requestedBy: 'u1' })],
    });
    expect(html).not.toContain('Message requests');
    expect(ids(html)).toEqual(['outbound']);
  });

  it('counts archived groups and archived DMs in one section', () => {
    const html = render({
      groups: [group('live'), group('old-group', { isArchived: true })],
      dmThreads: [dm('old-dm', { isArchived: true })],
    });
    expect(html).toContain('Archived (2)');
    // The live group is listed first, the two archived ones after the heading.
    expect(ids(html)).toEqual(['live', 'old-dm', 'old-group']);
  });

  it('lists a collapsed parent group without its sub-groups', () => {
    const html = render({
      groups: [group('parent'), group('child', { parentId: 'parent' })],
    });
    expect(ids(html)).toEqual(['parent']);
  });

  it('lists a sub-group under its parent once that parent is expanded', () => {
    const html = render({
      groups: [group('parent'), group('child', { parentId: 'parent' })],
      expandedParentGroups: { parent: true },
    });
    expect(ids(html)).toEqual(['parent', 'child']);
  });
});
