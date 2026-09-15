/**
 * The one place that decides what "Share a set" copies and what it SAYS.
 *
 * WHY THIS IS NOT A ONE-LINER. A share affordance is a promise: the student
 * taps it because they want someone else to open the thing. Lantern cannot
 * keep that promise today, and the audit that produced this file is worth
 * writing down so the next person does not re-derive it:
 *
 *   - `study_sets.visibility` exists (`20260911130000_study_set_workspace.sql`)
 *     and both clients already offered a Private/Public toggle, but the SELECT
 *     policy in `20260911120000_study_sets.sql` is `user_id = auth.uid()` and
 *     was never widened for `visibility = 'public'`. The column is WRITTEN and
 *     never READ.
 *   - Every study-set endpoint is mounted under `/users/me/study-sets/...` and
 *     filters on the caller's own id; there is no token, no invite table, and
 *     no unauthenticated route that renders a set (`PUBLIC_PATH_PREFIXES` has
 *     no `/study`).
 *
 * So a recipient who opens a set link today is bounced to the auth screen, and
 * signed in as anyone else gets an empty set. The copy below therefore never
 * says "anyone with the link can open this" — not even when the set is flagged
 * public, because that flag currently changes nothing. Both clients previously
 * claimed exactly that, which is the bug this module ends.
 *
 * When real sharing lands (an RLS policy honouring `visibility`, matching
 * policies on units/topics/notes/decks, a non-`/users/me` read path, and the
 * route added to the public allowlist), `recipientCanOpen` is the single flag
 * to flip and both clients follow.

 *
 * CONSUMERS: web + mobile share affordances on a study set. Not the api.
 *
 * GOTCHAS: `packages/shared` is consumed BUILT — run `npm run build` in
 * packages/shared before typechecking or running web/mobile, or consumers
 * resolve a stale `dist/`. A NEW subpath under src/ needs three things: the
 * file, a `packages/shared/package.json` "exports" entry, and an
 * `apps/api-server/tsconfig.json` "paths" entry; mobile jest maps
 * `@lantern/shared/*` subpaths separately, so a subpath imported only by a
 * test produces a CI-only TS2307 (reproduce with `jest --no-cache`). The web
 * turbo build compiles with strict `noUncheckedIndexedAccess`.
 */

/** The two values `study_sets.visibility` is constrained to. */
export type StudySetShareVisibility = 'private' | 'public';

/** The canonical web origin a link is built against when none is supplied. */
export const STUDY_SET_SHARE_ORIGIN = 'https://lanternstudy.com';

export interface StudySetShareInput {
  setId: string;
  title: string;
  /**
   * The set's stored visibility. Accepted so the copy can be specific about
   * WHY a public set still is not openable, not because it grants access.
   */
  visibility?: StudySetShareVisibility | string | null;
  /**
   * Where the app is actually served from — `window.location.origin` on web.
   * Falsy, blank, or non-http values fall back to the production origin so a
   * link is never built against `about:blank` or a native scheme.
   */
  origin?: string | null;
}

export interface StudySetShareLink {
  /** The app link to the set room. */
  url: string;
  /** The set's name, for a share sheet's subject line. */
  title: string;
  /** Web: the toast shown after the copy succeeds. */
  toast: string;
  /** Mobile: the share sheet's body — the link plus the same honest caveat. */
  message: string;
  /**
   * Whether someone OTHER than the owner could open this link. Always false
   * today; see the module comment for what has to ship before it is not.
   */
  recipientCanOpen: boolean;
}

/** Trailing slashes and a non-web origin are both link-breaking. */
function normalizeOrigin(origin?: string | null): string {
  const trimmed = (origin ?? '').trim().replace(/\/+$/, '');
  if (!trimmed) return STUDY_SET_SHARE_ORIGIN;
  if (!/^https?:\/\/[^/]+$/i.test(trimmed)) return STUDY_SET_SHARE_ORIGIN;
  return trimmed;
}

/** The set room's path. Mirrors `studySetRoutes`' own `/study/sets/<id>`. */
export function studySetShareUrl(setId: string, origin?: string | null): string {
  return `${normalizeOrigin(origin)}/study/sets/${encodeURIComponent(setId.trim())}`;
}

/**
 * Builds the link and the sentences that go with it.
 *
 * Pure: no clipboard, no share sheet, no toast store. The two client wrappers
 * (`components/study/shareStudySet.ts` and its mobile twin) own the side
 * effects so this stays testable and so web and mobile cannot drift apart on
 * what the student is told.
 */
export function buildStudySetShareLink(input: StudySetShareInput): StudySetShareLink {
  const url = studySetShareUrl(input.setId, input.origin);
  const title = input.title.trim() || 'Study set';
  const isPublic = input.visibility === 'public';

  // ONE caveat sentence, said once. It used to be assembled twice into the
  // share-sheet body ("Only the owner can open this link for now — this set is
  // private, so only you can open it for now"), which read as a stutter and
  // made the honest part easy to skim past.
  //
  // The subject is the only thing that changes: whether the student has already
  // flipped the toggle and would otherwise expect the link to work.
  const subject = isPublic
    ? 'Public sets are not readable by anyone else yet'
    : 'This set is private';

  return {
    url,
    title,
    toast: `Link copied. ${subject} — only you can open it for now.`,
    message: `${title}\n${url}\n\n${subject} — only you can open the link for now.`,
    recipientCanOpen: false,
  };
}
