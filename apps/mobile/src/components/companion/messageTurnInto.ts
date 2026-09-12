/**
 * Turning ONE chat answer into study material, on the phone.
 *
 * The panel is a modal mounted once at the root, so it has no room props to
 * read: where the answer gets filed, and which studio it can open, both have
 * to be derived from the route the sheet came up over. Deriving is exactly the
 * kind of thing that goes wrong silently, so it happens here, in pure
 * functions a test can pin down.
 *
 * What a message CAN become — and the note it becomes — is shared with web in
 * `@lantern/shared` (`messageTurnInto.ts`); only the navigation is local.
 */
// Subpath imports, not the barrel: mobile's jest maps `@lantern/shared/<path>`
// but not the bare package, so a bare import here is a CI-only TS2307.
import type { MessageNoteDraft } from '@lantern/shared/learning/messageTurnInto';
import type { TurnIntoTargetId } from '@lantern/shared/learning/courseWorkspace';

/** Where an answer gets filed, read off the screen the sheet opened over. */
export interface CompanionRoomScope {
  studySetId?: string;
  courseId?: string;
  /** The room's human name, for the studio header. */
  courseLabel?: string;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * The room behind the sheet.
 *
 * A course id is only carried when the route actually named one: filing a
 * chat answer into whatever course a NOTE happened to belong to would put it
 * somewhere the student never chose.
 */
export function roomScopeFromRouteParams(
  params?: Record<string, unknown> | null
): CompanionRoomScope {
  return {
    studySetId: str(params?.studySetId),
    courseId: str(params?.courseId),
    courseLabel: str(params?.courseLabel),
  };
}

/** The payload that files a drafted note in the room the student is standing in. */
export function messageNotePayload(
  draft: MessageNoteDraft,
  scope: CompanionRoomScope
): MessageNoteDraft & { studySetId?: string; courseId?: string } {
  return {
    ...draft,
    ...(scope.studySetId ? { studySetId: scope.studySetId } : {}),
    ...(scope.courseId ? { courseId: scope.courseId } : {}),
  };
}

export interface StudioRoute {
  screen: 'LessonStudio' | 'RecapStudio' | 'EssayStudio' | 'PlayStudio';
  params: Record<string, string | undefined>;
}

const STUDIO_SCREENS: Partial<Record<TurnIntoTargetId, StudioRoute['screen']>> = {
  lesson: 'LessonStudio',
  recap: 'RecapStudio',
  essay: 'EssayStudio',
  play: 'PlayStudio',
};

/**
 * Where a studio target goes once the answer has been saved.
 *
 * `null` for cards and test, which start a job rather than open a screen, and
 * `null` for a studio with no room to open in: every studio screen is a room
 * screen, and pushing one with no course and no set lands on an empty shell.
 * The caller says so out loud rather than navigating into nothing.
 */
export function messageTurnIntoStudioRoute(
  target: TurnIntoTargetId,
  scope: CompanionRoomScope,
  noteId: string
): StudioRoute | null {
  const screen = STUDIO_SCREENS[target];
  if (!screen) return null;
  if (!scope.studySetId && !scope.courseId) return null;
  const base = {
    courseId: scope.courseId,
    courseLabel: scope.courseLabel,
    studySetId: scope.studySetId,
  };
  // Play shuffles the room's existing cards; it has no note to open on.
  return { screen, params: screen === 'PlayStudio' ? base : { ...base, noteId } };
}
