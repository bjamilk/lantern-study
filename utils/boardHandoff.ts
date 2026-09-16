/**
 * The §7 board-handoff rule: what a study group owes the board it was started
 * from.
 *
 * Exports: `announceStudyGroupToBoard`, and the `SendBoardMessage` shape it
 *  posts through.
 * Touches: nothing. The transport is injected, so this module imports only the
 *  shared copy helper and can be read — and tested — on its own.
 * Gotchas:
 *  - Lifted verbatim (M7) out of a JSX prop on `CreateGroupScreen`, where it
 *    had no test and no name. The comment above the call site moved with it.
 *  - Fire-and-forget is the rule, not an oversight: see below.
 */
import { studyGroupAnnouncement } from '@lantern/shared/network';

/** How the pointer is posted. Injected so the rule can be exercised directly. */
export type SendBoardMessage = (
    groupId: string,
    senderId: string,
    text: string,
) => Promise<unknown>;

/**
 * §7 entry point 3: a group spawned from a board post leaves a plain TEXT
 * pointer behind on that board, so the conversation keeps a link to what it
 * produced.
 *
 * Fire-and-forget — the handoff must not wait on it, and a board that cannot be
 * posted to must not stop the student landing in the new group. That is why
 * this returns void and swallows the rejection.
 */
export function announceStudyGroupToBoard(
    preset: { announceInGroupId?: string },
    actor: { id: string; name: string } | null | undefined,
    groupName: string,
    send: SendBoardMessage,
): void {
    if (!preset.announceInGroupId || !actor) return;
    void send(
        preset.announceInGroupId,
        actor.id,
        studyGroupAnnouncement(actor.name, groupName),
    ).catch(() => undefined);
}
