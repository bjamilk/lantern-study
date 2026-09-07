/**
 * Read-it-to-me (web).
 *
 * The player is the only public face of this folder; the speech engine and the
 * remembered position are its private machinery, and the arithmetic lives in
 * utils/narrationPlayerModel so it can be tested without a browser.
 */
export { default as NarrationPlayer } from './NarrationPlayer';
export type { NarrationPlayerProps } from './NarrationPlayer';
export {
  loadNarrationPosition,
  narrationPositionIsPersistent,
  saveNarrationPosition,
} from './narrationPosition';
