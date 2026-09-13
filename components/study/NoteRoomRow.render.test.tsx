import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NoteRoomRow } from './NoteRoomRow';
import { StudySetArtifactLibrary } from './StudySetArtifactLibrary';

/**
 * The ⋮ rule, held on both room surfaces that carry one.
 *
 * A note row and a deck tile are both a big click target with a small menu on
 * it, and the way that goes wrong is identical on both: put the trigger inside
 * the target and you have a <button> in a <button> — invalid markup that the
 * keyboard cannot reach and that fires "open" on every click of the menu. So
 * the test each surface gets is the same one: the menu exists, and it is a
 * sibling of the button, not a descendant.
 */
const menuMarkup = (label: string) => (
  <button type="button" aria-label={label}>
    ⋮
  </button>
);

/** Text of the outer element's first <button>, up to its closing tag. */
const firstButton = (html: string) => html.slice(html.indexOf('<button'), html.indexOf('</button>'));

describe('NoteRoomRow', () => {
  it('shows the note title and opens on the row button', () => {
    const html = renderToStaticMarkup(<NoteRoomRow title="Untitled note" onOpen={() => {}} />);
    expect(html).toContain('Untitled note');
    expect(html.match(/<button/g) || []).toHaveLength(1);
  });

  it('renders the ⋮ beside the row button, never inside it', () => {
    const html = renderToStaticMarkup(
      <NoteRoomRow
        title="Gas exchange"
        onOpen={() => {}}
        menu={menuMarkup('Note options for Gas exchange')}
      />
    );
    expect(html).toContain('aria-label="Note options for Gas exchange"');
    // Two buttons, and the trigger is not inside the first one.
    expect(html.match(/<button/g) || []).toHaveLength(2);
    expect(firstButton(html)).not.toContain('Note options');
  });

  it('renders no menu slot at all when the note is not the viewer’s to change', () => {
    const html = renderToStaticMarkup(<NoteRoomRow title="Shared note" onOpen={() => {}} menu={null} />);
    expect(html.match(/<button/g) || []).toHaveLength(1);
  });
});

describe('StudySetArtifactLibrary tiles', () => {
  const item = {
    id: 'd1',
    title: 'Unit 1 deck',
    feature: 'flashcards' as const,
    icon: 'layers' as const,
  };

  it('renders the tile ⋮ beside the tile button, never inside it', () => {
    const html = renderToStaticMarkup(
      <StudySetArtifactLibrary
        title="Cards"
        empty="none"
        items={[item]}
        onOpen={() => {}}
        renderItemMenu={() => menuMarkup('Deck options for Unit 1 deck')}
      />
    );
    expect(html).toContain('aria-label="Deck options for Unit 1 deck"');
    expect(firstButton(html)).not.toContain('Deck options');
  });
});
