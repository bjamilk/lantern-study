/**
 * The module-level send guards and delivery-intent registries shared by the
 * chat handler hooks, moved verbatim out of `hooks/useGroupHandlers.ts`.
 *
 * Exports: `sendingGroupIds`, `sendingThreadIds`, `submittingQuestionGroupIds`
 *  (in-flight guards), `groupDeliveryIntents` / `dmDeliveryIntents` (the
 *  clientMessageId registries) and `MessageSendBusyError`.
 * Touches: nothing. It holds process-wide state and no behaviour.
 * Gotchas:
 *  - These are MODULE-level, not per-mount, on purpose: a remount must not let
 *    the same send, question submit or vote fire twice. They live here rather
 *    than in one of the hooks because the question board and the message
 *    composer both post into `group:<id>` and must share one registry — two
 *    copies would each mint their own clientMessageId and the server could no
 *    longer dedupe a retry.
 *  - The two SEND locks THROW `MessageSendBusyError` when held (E3 H16); they
 *    must never return silently, because the composer clears the text the
 *    student typed before awaiting and restores it only from a rejection.
 */
import { DeliveryIntentRegistry } from '@lantern/shared/utils';

// Module-level (not per-mount) in-flight guards: a remount must not let the same send,
// question submit or vote fire twice. The two DeliveryIntentRegistry instances hold the
// clientMessageId minted for each distinct payload so a retry reuses it instead of posting
// a second copy.
export const sendingGroupIds = new Set<string>();
export const sendingThreadIds = new Set<string>();

/**
 * Thrown when a send is refused because one is already in flight for the same
 * group or DM thread (E3 H16). The composer catches it, restores the text the
 * student typed and shows this sentence — silence used to eat the message.
 */
export class MessageSendBusyError extends Error {
    constructor(message = 'Still sending your last message — your text was kept, try again in a moment.') {
        super(message);
        this.name = 'MessageSendBusyError';
    }
}
export const submittingQuestionGroupIds = new Set<string>();
export const groupDeliveryIntents = new DeliveryIntentRegistry();
export const dmDeliveryIntents = new DeliveryIntentRegistry();
