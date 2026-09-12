import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { STUDY_AREA_SECTIONS } from '@lantern/shared';
import { StudyWorkspaceBar } from './StudyWorkspaceBar';

const render = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);

describe('StudyWorkspaceBar', () => {
  it('offers Study and Library as peer tabs', () => {
    const html = render(<StudyWorkspaceBar active="study" onSelect={() => undefined} />);
    expect(html).toContain('aria-label="Study sections"');
    for (const tab of STUDY_AREA_SECTIONS) {
      expect(html).toContain(`aria-label="${tab.label}"`);
    }
    expect(html).toContain('data-tip-id="nav.library"');
  });

  it('marks only the active section selected', () => {
    const study = render(<StudyWorkspaceBar active="study" onSelect={() => undefined} />);
    expect(study).toContain('aria-label="Study"');
    expect(study).toContain('aria-selected="true"');
    expect(study).toContain('aria-selected="false"');

    const library = render(<StudyWorkspaceBar active="library" onSelect={() => undefined} />);
    expect(library).toContain('aria-label="Library"');
    expect(library.match(/aria-selected="true"/g)).toHaveLength(1);
  });
});
