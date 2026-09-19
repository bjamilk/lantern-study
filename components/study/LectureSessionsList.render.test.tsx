import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LectureSessionsList } from './LectureSessionsList';

const render = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);
const visibleText = (html: string) => html.replace(/<[^>]*>/g, '');

const today = new Date();
const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1, 9, 0);

const LECTURES = [
  { id: 'a', title: 'Thermodynamics', createdAt: today.toISOString() },
  { id: 'b', title: 'Kinetics', createdAt: yesterday.toISOString() },
];

const renderList = () =>
  render(
    <LectureSessionsList
      lectures={LECTURES}
      onOpen={() => undefined}
      onCreate={() => undefined}
      onRename={() => undefined}
      onDelete={() => undefined}
    />
  );

describe('lectures list', () => {
  it('groups rows under day headings, newest day first', () => {
    const text = visibleText(renderList());
    expect(text).toContain('Lectures');
    expect(text).toContain('+ New lecture');
    expect(text.indexOf('Today')).toBeLessThan(text.indexOf('Yesterday'));
    expect(text.indexOf('Thermodynamics')).toBeLessThan(text.indexOf('Kinetics'));
  });

  it('searches, opens and names every control', () => {
    const html = renderList();
    expect(html).toContain('id="lecture-search"');
    expect(html).toContain('aria-label="Open Thermodynamics"');
    expect(html).toContain('aria-label="Actions for Thermodynamics"');
  });

  it('says nothing it has not got, when the set has no lectures', () => {
    const html = render(
      <LectureSessionsList
        lectures={[]}
        onOpen={() => undefined}
        onCreate={() => undefined}
        onRename={() => undefined}
        onDelete={() => undefined}
      />
    );
    expect(visibleText(html)).toContain('Record a lecture or open one you already filed.');
  });
});
