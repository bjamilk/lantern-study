/**
 * What a created test session tells the server about the room it came from.
 *
 * Live, a set room's Test tab was empty for every set and every user: the tab
 * lists `GET /tests?studySetId=…`, and all 77 of the account's sessions carried
 * no `study_set_id`. Only `POST /tests/personal` ever sent one — the session
 * create (`POST /tests`) and the draft create (`POST /tests/drafts`) both
 * dropped it, at every call site, because each built its payload inline.
 *
 * This is the one place that answers "which set is this session in?", so a new
 * create path cannot forget the question. The set travels on `config` (where
 * `courseId` and `topicId` already live) and may also be passed explicitly;
 * explicit wins, since a caller that names the room is more specific than a
 * config inherited from the test being retaken.
 *
 * Sessions created before this shipped cannot be back-attributed: nothing was
 * recorded about the room they were started in.
 */

/** A session config, as far as the set is concerned. */
type SetBearingConfig = { studySetId?: string | null } | null | undefined;

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * The set a session belongs to, or null when it genuinely belongs to none
 * (a group-chat test, or a deck that is not filed under a set).
 */
export function resolveSessionStudySetId(input: {
  studySetId?: string | null;
  config?: SetBearingConfig;
}): string | null {
  return clean(input.studySetId) ?? clean(input.config?.studySetId);
}

/**
 * Add `studySetId` to a create payload, and only when there is one — an
 * explicit `null` on every group-chat test would be noise on the wire, and the
 * server treats a missing field and a null one the same way.
 */
export function withStudySetId<T extends Record<string, unknown>>(
  payload: T,
  input: { studySetId?: string | null; config?: SetBearingConfig }
): T & { studySetId?: string } {
  const studySetId = resolveSessionStudySetId(input);
  return studySetId ? { ...payload, studySetId } : payload;
}
