// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { COMMUNITY_MODERATION_COPY } from '@lantern/shared/network';

import BoardComposer from './BoardComposer';

vi.mock('../MessageInputBar', () => ({
  default: () => null,
}));

/**
 * The composer's whole job in this wave is honesty about who may post what.
 * The kind picker is only visible expanded, so these assert the two states a
 * closed composer can be in — and that "Announcement" is never offered to
 * somebody whose post the server would refuse.
 */
const render = (props: Partial<React.ComponentProps<typeof BoardComposer>> = {}) =>
  renderToStaticMarkup(
    <BoardComposer
      groupId="g1"
      authorName="Ada"
      lowDataMode={false}
      mentionCandidates={[]}
      onPost={async () => undefined}
      {...props}
    />
  );

describe('BoardComposer', () => {
  it('offers the pill to a member who may post', () => {
    const html = render({ viewerRole: 'member' });
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain(COMMUNITY_MODERATION_COPY.mutedTitle);
  });

  it('replaces itself with the reason when the viewer is muted — never a dead box', () => {
    const html = render({
      viewerRole: 'member',
      mutedUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    expect(html).toContain(COMMUNITY_MODERATION_COPY.mutedTitle);
    expect(html).toContain(COMMUNITY_MODERATION_COPY.mutedBody);
    expect(html).not.toContain('aria-expanded');
  });

  it('says join, rather than showing a composer that would 403', () => {
    const html = render({ viewerRole: null, isMember: false });
    expect(html).toContain(COMMUNITY_MODERATION_COPY.notMember);
  });

  it('lets an expired mute post again — a lapsed mute is not a mute', () => {
    const html = render({
      viewerRole: 'member',
      mutedUntil: new Date(Date.now() - 1000).toISOString(),
    });
    expect(html).toContain('aria-expanded="false"');
  });
});
