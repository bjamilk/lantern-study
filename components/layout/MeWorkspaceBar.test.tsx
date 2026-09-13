import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ME_AREA_SECTIONS } from '@lantern/shared';
import { MeWorkspaceBar } from './MeWorkspaceBar';

const render = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);

describe('MeWorkspaceBar', () => {
  it('offers Profile and Progress as peer tabs', () => {
    const html = render(<MeWorkspaceBar active="profile" onSelect={() => undefined} />);
    expect(html).toContain('aria-label="Profile sections"');
    for (const tab of ME_AREA_SECTIONS) {
      expect(html).toContain(`aria-label="${tab.label}"`);
    }
  });

  it('marks only the active section selected', () => {
    const profile = render(<MeWorkspaceBar active="profile" onSelect={() => undefined} />);
    expect(profile).toContain('aria-label="Profile"');
    expect(profile.match(/aria-selected="true"/g)).toHaveLength(1);

    const progress = render(<MeWorkspaceBar active="progress" onSelect={() => undefined} />);
    expect(progress).toContain('aria-label="Progress"');
    expect(progress.match(/aria-selected="true"/g)).toHaveLength(1);
  });
});
