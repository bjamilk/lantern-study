export {
  pageHeadings,
  walkthroughCheckpoint,
  type PageLike,
  type PageHeading,
} from './pages';

/**
 * The player half of "read it to me". The SCRIPT half lives in ./narration and
 * is imported by its own subpath — it carries a `normalizeNarrationSegments`
 * and a `NarrationStatus` of its own, and re-exporting both files wholesale
 * from one barrel would collide on names that mean different things.
 */
export {
  DEFAULT_NARRATION_RATE,
  NARRATION_FOREGROUND_NOTICE,
  NARRATION_RATES,
  clampNarrationRate,
  currentPageIndex,
  firstSegmentOfPage,
  initialNarrationState,
  narrationPositionLabel,
  narrationReducer,
  nextPageSegment,
  prevPageSegment,
  type NarrationAction,
  type NarrationPlaybackStatus,
  type NarrationPlayerState,
  type PlayablePageSegment,
} from './narrationPlayer';
