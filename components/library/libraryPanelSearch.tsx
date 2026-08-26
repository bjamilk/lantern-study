import React, { createContext, useContext } from 'react';

/**
 * The Library's search box, handed down to whichever tab panel is open so that
 * panel filters its own list in place.
 *
 * The Library has one search box, and it has to do two different jobs. Typing
 * narrows the list on screen — instantly, from the first character, entirely
 * client-side, and *under* the folder / Mine-Shared / Active-Archived selection
 * the panel is still showing. Searching across decks, cards and offline bundles
 * is the other job: it needs the network, needs two characters, and cannot
 * honour those panel filters, so it replaces the panel and is something the
 * student steps into deliberately (the "Search everything" action in the scope
 * row), never something typing does to them.
 *
 * A context rather than a prop because the panels are built by App.tsx and
 * handed to the Library as `notesContent` / `flashcardsContent`; only the
 * ancestor that owns the box knows what was typed. Outside the Library the
 * value is `''` and each screen keeps its own search box, which is then the
 * only one on screen.
 */
const LibraryPanelSearch = createContext('');

export const LibraryPanelSearchProvider: React.FC<{ query: string; children: React.ReactNode }> = ({
  query,
  children,
}) => <LibraryPanelSearch.Provider value={query}>{children}</LibraryPanelSearch.Provider>;

/** The Library's live query, or `''` when this screen is not inside the Library. */
export const useLibraryPanelSearch = (): string => useContext(LibraryPanelSearch);
