import { Platform } from 'react-native';

/**
 * Windowing props shared by the chat lists (group chat, DMs, threads, the chat
 * list itself). Spread these onto a `FlatList`.
 *
 * `removeClippedSubviews` is deliberately **Android only**. On iOS it blanks
 * cells on scroll and breaks `scrollToIndex` / `scrollToEnd`, which every one of
 * these screens depends on for jump-to-message, jump-to-latest and the initial
 * unread anchor.
 */
export const CHAT_LIST_WINDOWING = {
  initialNumToRender: 15,
  maxToRenderPerBatch: 10,
  updateCellsBatchingPeriod: 50,
  windowSize: 11,
  removeClippedSubviews: Platform.OS === 'android',
} as const;
