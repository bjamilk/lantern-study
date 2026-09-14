/** How far from an edge counts as "more chips that way". */
const EDGE_SLACK_PX = 2;

export function overflowChipDirections(
  scrollLeft: number,
  clientWidth: number,
  scrollWidth: number
): { left: boolean; right: boolean } {
  return {
    left: scrollLeft > EDGE_SLACK_PX,
    right: scrollLeft + clientWidth < scrollWidth - EDGE_SLACK_PX,
  };
}

export const OVERFLOW_CHIP_SCROLL_PX = 200;
