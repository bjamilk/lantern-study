/**
 * Barrel for the Campus tab: the screen itself plus the pure segment helpers
 * (labels, resolveCampusSegment(s), shouldShowSegmentBar) that the navigator
 * and the contextual bars read.
 */
export { CampusScreen, default } from './CampusScreen';
export {
  CAMPUS_SEGMENT_LABELS,
  resolveCampusSegment,
  resolveCampusSegments,
  shouldShowSegmentBar,
  type CampusGateState,
  type CampusSegment,
} from './campusSegments';
