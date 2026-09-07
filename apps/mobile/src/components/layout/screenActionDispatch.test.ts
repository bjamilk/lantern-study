/**
 * The screen-action lookup rule (spec v3 §7.2, the `NoteEditor` row).
 *
 * The interesting cases are all silences: a press with no focused route, a
 * press for an action this screen never registered, and — the one that would
 * be a real bug on device — a press addressed to route A finding route B's
 * handler because both screens are mounted and both call their action `cards`.
 */

import {
  planScreenActionDispatch,
  screenActionEntries,
  screenActionKey,
  type ScreenActionHandler,
} from './screenActionDispatch';

function registry(
  ...entries: Array<[string, string, ScreenActionHandler]>
): Map<string, ScreenActionHandler> {
  const map = new Map<string, ScreenActionHandler>();
  for (const [route, action, handler] of entries) map.set(screenActionKey(route, action), handler);
  return map;
}

describe('screenActionKey', () => {
  it('is stable for the same route and action', () => {
    expect(screenActionKey('NoteEditor', 'cards')).toBe(screenActionKey('NoteEditor', 'cards'));
  });

  it('separates the route from the action with a character neither can contain', () => {
    // Without this, `('Note', 'Editor:cards')` and `('Note:Editor', 'cards')`
    // would be the same key and one screen would run the other's work.
    expect(screenActionKey('Note', 'Editor cards')).not.toBe(screenActionKey('Note Editor', 'cards'));
    expect(screenActionKey('Note', 'Editor:cards')).not.toBe(screenActionKey('Note:Editor', 'cards'));
  });
});

describe('planScreenActionDispatch', () => {
  it('runs the handler the focused route registered', () => {
    const cards = jest.fn();
    const plan = planScreenActionDispatch({
      handlers: registry(['NoteEditor', 'cards', cards]),
      route: 'NoteEditor',
      action: 'cards',
    });
    expect(plan).toEqual({ kind: 'run', handler: cards });
  });

  it('does nothing when the screen has not registered that action', () => {
    const plan = planScreenActionDispatch({
      handlers: registry(['NoteEditor', 'learn', jest.fn()]),
      route: 'NoteEditor',
      action: 'cards',
    });
    expect(plan).toEqual({ kind: 'none', reason: 'unregistered' });
  });

  it('does nothing while no route is focused', () => {
    const plan = planScreenActionDispatch({
      handlers: registry(['NoteEditor', 'cards', jest.fn()]),
      route: undefined,
      action: 'cards',
    });
    expect(plan).toEqual({ kind: 'none', reason: 'no-route' });
  });

  it('does nothing for an empty action id', () => {
    const plan = planScreenActionDispatch({
      handlers: registry(['NoteEditor', 'cards', jest.fn()]),
      route: 'NoteEditor',
      action: '',
    });
    expect(plan).toEqual({ kind: 'none', reason: 'no-action' });
  });

  it('never runs another route’s handler for the same action name', () => {
    // Two screens are mounted — one pushed over the other — and both call
    // their action `cards`. The row belongs to the screen on top.
    const editorCards = jest.fn();
    const deckCards = jest.fn();
    const plan = planScreenActionDispatch({
      handlers: registry(['NoteEditor', 'cards', editorCards], ['DeckDetail', 'cards', deckCards]),
      route: 'DeckDetail',
      action: 'cards',
    });
    expect(plan).toEqual({ kind: 'run', handler: deckCards });
  });

  it('does nothing at all with an empty registry', () => {
    expect(
      planScreenActionDispatch({ handlers: new Map(), route: 'NoteEditor', action: 'learn' })
    ).toEqual({ kind: 'none', reason: 'unregistered' });
  });
});

describe('screenActionEntries', () => {
  it('keys every handler a screen offers under its own route', () => {
    const learn = jest.fn();
    const cards = jest.fn();
    expect(screenActionEntries('NoteEditor', { learn, cards })).toEqual([
      [screenActionKey('NoteEditor', 'learn'), learn],
      [screenActionKey('NoteEditor', 'cards'), cards],
    ]);
  });

  it('drops an action the screen cannot offer right now', () => {
    // A read-only note has no Cards: the row press then falls through to
    // nothing rather than to a handler that would alert.
    const learn = jest.fn();
    const entries = screenActionEntries('NoteEditor', { learn, cards: undefined });
    expect(entries).toEqual([[screenActionKey('NoteEditor', 'learn'), learn]]);
  });

  it('round-trips through the registry the row looks in', () => {
    const learn = jest.fn();
    const handlers = new Map(screenActionEntries('NoteEditor', { learn }));
    expect(planScreenActionDispatch({ handlers, route: 'NoteEditor', action: 'learn' })).toEqual({
      kind: 'run',
      handler: learn,
    });
  });

  it('is empty for a screen with no actions', () => {
    expect(screenActionEntries('Library', {})).toEqual([]);
  });
});
