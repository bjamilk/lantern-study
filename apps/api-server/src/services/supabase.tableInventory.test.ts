/**
 * Table-inventory freeze for the data layer (monolith lane M1, step 1b).
 *
 * The public-surface freeze proved that no METHOD was lost as code moved out of
 * the monolith. It could not prove that no QUERY was lost: a delegation can
 * keep its name and arity while the moved body reads a different table, or
 * while a whole method body is quietly dropped because two sections looked
 * alike during a copy-paste extraction.
 *
 * So this test freezes the other half of the contract — the set of Postgres
 * tables the data layer touches. It was written to scan the union
 *
 *   `services/supabase.ts`  ∪  `services/data/**\/*.ts`
 *
 * and that union is what made it survive the extraction: in step 1 it was
 * `supabase.ts` alone, and with every later step the moved `.from("…")` calls
 * landed in `services/data/*` while the union stayed the same. The class is
 * deleted (lane M3) and `services/supabase.ts` now holds no queries at all, so
 * in practice this scans `services/data/**` — the file is still in the list
 * because a query appearing there again is exactly the regression the list is
 * for. THE FROZEN SET IS UNCHANGED; only this description is.
 *
 * A table that appears in NEITHER after a move is a query that was lost, and
 * this test fails.
 *
 * ## What counts as a table
 *
 * `.from("literal")` reached through `supabase.storage` is a STORAGE BUCKET,
 * not a table (`note-files` is the only such literal in the file today). Those
 * are excluded by matching `.storage.from(…)` first and subtracting those
 * offsets, so a bucket rename never masquerades as a table change.
 *
 * ## The dynamic sites — why a literal list is not the whole story
 *
 * Seven `.from(<identifier>)` call sites pass a variable rather than a literal,
 * so their tables can never appear in the frozen list. They are enumerated
 * explicitly below by the enclosing method name, because they are exactly the
 * sites where a careless extraction is invisible to a literal scan:
 *
 *   - `readMessageReactions`        — `scope === "dm" ? "dm_messages" : "messages"`
 *   - `assertCoverColumn`           — `COVER_TABLE_BY_KIND[kind]` (decks / notes / study_sets)
 *   - `attachReplyPreview`          — `"messages" | "dm_messages"` parameter
 *   - `attachReplyPreviewsBatch`    — `"messages" | "dm_messages"` parameter
 *   - `attachThreadReplyCounts`     — `"messages" | "dm_messages"` parameter
 *   - `resolveThreadRootForReply`   — `"messages" | "dm_messages"` parameter
 *   - `currentArtefactCourseId`     — `table: string` from the academic filing caller
 *
 * The count is frozen so that a moved method cannot silently acquire or lose a
 * dynamic table access. The `.storage.from(bucket)` sites are NOT counted here:
 * those are buckets, and the storage ACL owns them.
 *
 * If a future step INTENTIONALLY changes this inventory, update the counts in
 * the same commit and say so in the PR. Do not relax the assertions.
 */
import fs from 'fs';
import path from 'path';

const SERVICES_DIR = __dirname;
const DATA_DIR = path.join(SERVICES_DIR, 'data');

/**
 * The 58 distinct table literals reached through `.from("…")` by the data
 * layer, captured from the untouched 18,257-line `services/supabase.ts`.
 *
 * 57 of them are that original capture. `user_budgets` is the one addition
 * (monolith lane R2): it was ALWAYS queried by the server, but only ever from
 * `routes/budget.ts` and `routes/users.ts`, which this scan does not cover, so
 * the freeze had never seen it. Moving the route's query into
 * `services/data/budget.ts` brings the table into scope for the first time. No
 * table was added to the product, and no query changed. Nine more tables are in
 * the same position and will arrive the same way — they are listed in
 * `apps/api-server/docs/route-queries-plan.md`.
 */
const FROZEN_TABLES: readonly string[] = [
  'achievements',
  'budget_transactions',
  'chat_message_audit',
  'chat_mutes',
  'communities',
  'community_members',
  'courses',
  'creator_stats',
  'custom_categories',
  'deck_collaborators',
  'decks',
  'dm_messages',
  'dm_read_status',
  'dm_threads',
  'flashcard_comments',
  'flashcards',
  'group_members',
  'groups',
  'levels',
  'marketplace_campuses',
  'marketplace_favorites',
  'marketplace_inquiries',
  'marketplace_listings',
  'marketplace_offers',
  'marketplace_orders',
  'marketplace_question_bank_entitlements',
  'marketplace_reports',
  'marketplace_review_votes',
  'marketplace_reviews',
  'marketplace_transactions',
  'message_bookmarks',
  'message_reactions',
  'messages',
  'note_attachments',
  'note_collaborators',
  'note_comments',
  'note_folders',
  'note_quizzes',
  'note_share_links',
  'notes',
  'notifications',
  'offline_bundles',
  'platform_admins',
  'points_transactions',
  'profiles',
  'question_votes',
  'saved_searches',
  'study_activity',
  'study_sets',
  'test_results',
  'test_sessions',
  'test_templates',
  'user_achievements',
  'user_blocks',
  // From `routes/budget.ts` (lane R2); `routes/users.ts` reaches it too.
  'user_budgets',
  'user_preferences',
  'user_question_stats',
  'user_streaks',
];

/** Storage buckets reached through `supabase.storage.from("…")`, for contrast. */
const FROZEN_STORAGE_BUCKET_LITERALS: readonly string[] = ['note-files'];

/**
 * `.from(<identifier>)` sites on the Postgres client (NOT on `.storage`),
 * by the method that encloses them. See the banner for why they are listed.
 */
const FROZEN_DYNAMIC_TABLE_SITES: readonly string[] = [
  'readMessageReactions',
  'assertCoverColumn',
  'attachReplyPreview',
  'attachReplyPreviewsBatch',
  'attachThreadReplyCounts',
  'resolveThreadRootForReply',
  'currentArtefactCourseId',
];

function dataLayerSources(): string[] {
  const files = [path.join(SERVICES_DIR, 'supabase.ts')];
  if (fs.existsSync(DATA_DIR)) {
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith('.ts') && !entry.name.includes('.test.')) {
          files.push(full);
        }
      }
    };
    walk(DATA_DIR);
  }
  return files.sort();
}

type Scan = {
  tables: Set<string>;
  buckets: Set<string>;
  dynamicTableIdentifiers: number;
};

function scan(): Scan {
  const tables = new Set<string>();
  const buckets = new Set<string>();
  let dynamicTableIdentifiers = 0;

  for (const file of dataLayerSources()) {
    const source = fs.readFileSync(file, 'utf8');

    // 1. Storage buckets first, so their offsets can be subtracted below.
    const storageOffsets = new Set<number>();
    const storageLiteral = /\.storage\s*(?:\r?\n\s*)?\.\s*from\(\s*(['"])([^'"]+)\1\s*\)/g;
    for (let m = storageLiteral.exec(source); m; m = storageLiteral.exec(source)) {
      buckets.add(m[2]);
      storageOffsets.add(m.index + m[0].indexOf('.from('));
    }
    const storageDynamic = /\.storage\s*(?:\r?\n\s*)?\.\s*from\(\s*([A-Za-z_$][\w$]*)\s*\)/g;
    for (let m = storageDynamic.exec(source); m; m = storageDynamic.exec(source)) {
      storageOffsets.add(m.index + m[0].indexOf('.from('));
    }

    // 2. Every `.from("literal")` that is not one of those storage calls.
    const anyLiteral = /\.from\(\s*(['"])([^'"]+)\1\s*\)/g;
    for (let m = anyLiteral.exec(source); m; m = anyLiteral.exec(source)) {
      if (storageOffsets.has(m.index)) continue;
      tables.add(m[2]);
    }

    // 3. Every `.from(identifier)` that is neither a storage call nor one of
    //    the JS built-ins (`Array.from`, `Buffer.from`, `Set.from`).
    const anyDynamic = /(\w*)\.from\(\s*([A-Za-z_$][\w$]*)\s*\)/g;
    for (let m = anyDynamic.exec(source); m; m = anyDynamic.exec(source)) {
      const offset = m.index + m[0].indexOf('.from(');
      if (storageOffsets.has(offset)) continue;
      if (m[1] === 'Array' || m[1] === 'Buffer' || m[1] === 'Set') continue;
      dynamicTableIdentifiers += 1;
    }
  }

  return { tables, buckets, dynamicTableIdentifiers };
}

describe('services data layer table inventory', () => {
  const scanned = scan();

  it('touches exactly the frozen set of 58 tables', () => {
    expect([...scanned.tables].sort()).toEqual([...FROZEN_TABLES].sort());
    expect(FROZEN_TABLES).toHaveLength(58);
  });

  it('reaches exactly the frozen set of storage bucket literals', () => {
    expect([...scanned.buckets].sort()).toEqual(
      [...FROZEN_STORAGE_BUCKET_LITERALS].sort(),
    );
  });

  it('keeps exactly the frozen dynamic `.from(<identifier>)` table sites', () => {
    // The enclosing method names are in FROZEN_DYNAMIC_TABLE_SITES; the count is
    // what a scan can assert mechanically.
    expect(scanned.dynamicTableIdentifiers).toBe(
      FROZEN_DYNAMIC_TABLE_SITES.length,
    );
  });

  it('names each dynamic site by the method that encloses it', () => {
    const sources = dataLayerSources()
      .map((file) => fs.readFileSync(file, 'utf8'))
      .join('\n');
    for (const method of FROZEN_DYNAMIC_TABLE_SITES) {
      expect(sources).toContain(`${method}(`);
    }
  });

  it('scans a data layer that is not accidentally empty', () => {
    // Guards the failure mode where a path change makes every assertion above
    // pass against zero files.
    expect(dataLayerSources().length).toBeGreaterThan(0);
    expect(scanned.tables.size).toBeGreaterThan(50);
  });
});
