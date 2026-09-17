/**
 * Repo-wide guard: every PostgREST embed in a `.select()` string must name the
 * relationship it resolves through.
 *
 * WHY THIS EXISTS — the 2026-09-08 roster outage.
 * Migration 20260908120000_community_governance added
 * `community_members.muted_by uuid REFERENCES public.profiles(id)`. Because
 * `community_members.user_id` ALREADY referenced profiles(id), the table then
 * had TWO foreign keys to profiles, so the roster's bare embed —
 * `profiles!inner(...)` — became ambiguous, PostgREST answered PGRST201, and
 * every community's Members list broke on web and mobile while every gate
 * stayed green. The fix (914e3603) NAMED the constraint the embed resolves
 * through: `profiles!community_members_user_id_fkey!inner(...)`.
 *
 * The lesson is not "fix that one query" — it is that ANY bare embed is a
 * latent copy of that outage, armed the day a second foreign key to the same
 * target is added. A unit test cannot exercise PostgREST's relationship
 * resolver, so the durable guard is a source scan over the whole API surface.
 *
 * THE RULE. In a `.select()` string an embed is written `[alias:]target(...)`.
 * An embed is DISAMBIGUATED (allowed) when it either
 *   (a) carries an explicit hint that names a constraint or foreign-key column,
 *       i.e. `target!some_fkey(...)` — `!inner` / `!left` are join MODIFIERS,
 *       not names, so `target!inner(...)` is still bare; or
 *   (b) is written in column form, where the embed target IS the foreign-key
 *       column (e.g. `profiles:sender_id(...)`, `groups:group_id(...)`). Naming
 *       the column names exactly one relationship, so it can never be
 *       ambiguous. In this schema every FK column ends in `_id`, which is how
 *       the scan recognises the column form.
 * Everything else — `target(...)`, `alias:target(...)`, `target!inner(...)` —
 * is BARE and must be justified on the allowlist below.
 *
 * THE ALLOWLIST is the exception, not the default: it is the frozen inventory
 * of embeds that are undisambiguated yet unambiguous TODAY only because their
 * relationship is still single-FK — the exact fragile state community_members
 * was in the day before the outage. Each is safe now; each should eventually be
 * named. The guard fails the moment a NEW bare embed appears anywhere (a new
 * file::target, or one more occurrence of an already-listed one), so the debt
 * can only shrink. Remove the rule — stop treating bare embeds as violations —
 * and `classifyEmbed`'s unit tests below fail; add a bare embed and the
 * repo-scan test fails.
 *
 * THE SCAN'S REACH matters as much as the rule. A select is rarely a bare
 * literal at the call site: this codebase also writes `.select(MEMBER_SELECT)`,
 * `.select(this.orderSelect)`, `.select(rosterColumns(withMute))`,
 * `.select(withTopic ? A : B)`, and `(columns: string) => .select(columns)`
 * feature-detection wrappers. `rosterColumns` is the roster query itself, so a
 * scan that only read literal arguments would have missed its own motivating
 * bug. The scanner therefore reads the whole balanced argument, resolves names
 * through the file's literal bindings and the API's `export const` literals,
 * reads column-list bindings at their DEFINITION for the parameter-fed
 * wrappers, and freezes the short list of arguments it still cannot read — so
 * coverage can only grow, and a new embed cannot hide behind a new idiom.
 *
 * packages/shared builds no PostgREST select strings, so the scan is scoped to
 * apps/api-server/src.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const API_SRC = join(__dirname, '..');

const JOIN_MODIFIERS = new Set(['inner', 'left']);

type EmbedVerdict = 'named' | 'column-form' | 'bare';

/**
 * Classify a single embed target reference (the token immediately before `(`
 * in a select string, with any `alias:` prefix already stripped by the scanner
 * because the regex captures the target, not the alias).
 */
export function classifyEmbed(target: string): EmbedVerdict {
  const [base, ...hints] = target.split('!');
  const namesRelationship = hints.some((h) => !JOIN_MODIFIERS.has(h));
  if (namesRelationship) return 'named';
  if (/_id$/.test(base)) return 'column-form';
  return 'bare';
}

/** Pull every `.select( ... )` string-literal argument out of a source file. */
function extractSelectStrings(src: string): string[] {
  return scanSelects(src).columns;
}

/**
 * Read one string literal starting at `src[j]` (which must be a quote).
 * `${...}` placeholders in a template are flattened to a token so an
 * interpolated column list does not swallow the embeds around it.
 */
function readLiteral(src: string, start: number): { value: string; next: number } {
  const quote = src[start];
  let j = start + 1;
  let str = '';
  while (j < src.length && src[j] !== quote) {
    if (src[j] === '\\') {
      str += src[j] + (src[j + 1] ?? '');
      j += 2;
      continue;
    }
    if (quote === '`' && src[j] === '$' && src[j + 1] === '{') {
      let depth = 1;
      j += 2;
      str += 'PLACEHOLDER';
      while (j < src.length && depth > 0) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') depth--;
        if (depth > 0) j++;
      }
      j++;
      continue;
    }
    str += src[j];
    j++;
  }
  return { value: str, next: j + 1 };
}

/**
 * One `const NAME = '<literal>'` and the brace block it is visible in.
 * `scopeEnd` is `Infinity` for a module-scope binding.
 */
type LiteralBinding = { name: string; value: string; scopeStart: number; scopeEnd: number };

/**
 * The brace blocks of a file, as `[openIndex, closeIndex]` pairs, so a binding
 * and a `.select()` call can be placed relative to each other. Braces inside
 * strings, template placeholders, comments and regex literals are skipped —
 * a `/\{/` or a `// {` would otherwise desynchronise every scope after it.
 */
function blockRanges(src: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const open: number[] = [];
  let prev = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      i = nl === -1 ? src.length : nl;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      i = readLiteral(src, i).next;
      prev = 'x';
      continue;
    }
    // A `/` that cannot follow a value starts a regex literal, not a division.
    if (c === '/' && !/[\w$)\]]/.test(prev)) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < src.length && src[j] !== '\n') {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) {
          closed = true;
          break;
        }
        j++;
      }
      if (closed) {
        i = j + 1;
        prev = 'x';
        continue;
      }
    }
    if (c === '{') open.push(i);
    else if (c === '}') {
      const start = open.pop();
      if (start !== undefined) ranges.push([start, i]);
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return ranges;
}

/** The innermost brace block containing `pos`, or module scope. */
function enclosingScope(ranges: Array<[number, number]>, pos: number): [number, number] {
  let best: [number, number] | null = null;
  for (const range of ranges) {
    if (range[0] > pos || range[1] < pos) continue;
    if (!best || range[1] - range[0] < best[1] - best[0]) best = range;
  }
  return best ?? [0, Number.POSITIVE_INFINITY];
}

/**
 * Names bound to a string literal in the file, WITH the scope each is visible
 * in, so a select passed by NAME can still be read. Covers the four idioms
 * this codebase uses:
 *   const MEMBER_SELECT = '...'            (module const)
 *   private orderSelect = `...`            (class property)
 *   const rosterColumns = (withMute) => `...`   (arrow returning the columns)
 *   const cartSelect = `...`
 * Without this, `.select(SECTION_SELECT_BASE)` / `.select(rosterColumns(x))`
 * are invisible — and `rosterColumns` is the ACTUAL query the roster outage
 * broke, so the guard would have missed its own motivating bug.
 *
 * Bindings are keyed by (name, scope) rather than by name alone. A flat
 * last-one-wins map collapsed two different `const selectClause = …` in one
 * file into a single entry, so a select passed by that name was scanned
 * against whichever literal the regex happened to see last — in an 18k-line
 * file that is easy to hit, and `getFlashcards` was resolved through an
 * unrelated chat select for as long as both lived in `services/supabase.ts`.
 */
function literalBindings(src: string): LiteralBinding[] {
  const ranges = blockRanges(src);
  const out: LiteralBinding[] = [];
  const re =
    /(?:const|let|var|readonly|private|public|protected)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]*)?=\s*(?:(?:async\s*)?\([^)]*\)\s*(?::\s*[^=\n]*)?=>\s*)?(?=['"`])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const quoteAt = m.index + m[0].length;
    const [scopeStart, scopeEnd] = enclosingScope(ranges, m.index);
    out.push({ name: m[1], value: readLiteral(src, quoteAt).value, scopeStart, scopeEnd });
  }
  return out;
}

/**
 * The literal a name refers to AT `pos`: the binding whose enclosing scope is
 * the nearest one containing the call site. A name with more than one
 * candidate in that nearest scope is deliberately left UNRESOLVED (undefined)
 * rather than guessed, so the guard fails loudly — landing in the frozen
 * `unresolved` ledger — instead of silently checking the wrong columns.
 */
function resolveBinding(
  bindings: LiteralBinding[],
  name: string,
  pos: number,
): string | undefined {
  const inScope = bindings.filter(
    (b) => b.name === name && b.scopeStart <= pos && pos <= b.scopeEnd,
  );
  if (inScope.length === 0) return undefined;
  const span = (b: LiteralBinding) => b.scopeEnd - b.scopeStart;
  const nearest = Math.min(...inScope.map(span));
  const candidates = inScope.filter((b) => span(b) === nearest);
  return candidates.length === 1 ? candidates[0].value : undefined;
}

/** Names exported from ANY api source file, for a select imported across files. */
let exportedBindingsCache: Record<string, string> | null = null;
function exportedLiteralBindings(): Record<string, string> {
  if (exportedBindingsCache) return exportedBindingsCache;
  const out: Record<string, string> = {};
  const re = /export\s+const\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]*)?=\s*(?=['"`])/g;
  for (const file of listSourceFiles(API_SRC)) {
    const src = readFileSync(file, 'utf8');
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      out[m[1]] = readLiteral(src, m.index + m[0].length).value;
    }
  }
  exportedBindingsCache = out;
  return out;
}

/** The balanced `(...)` argument region that starts just after `.select(`. */
function argumentRegion(src: string, start: number): { text: string; end: number } {
  let depth = 1;
  let j = start;
  while (j < src.length && depth > 0) {
    const c = src[j];
    if (c === "'" || c === '"' || c === '`') {
      j = readLiteral(src, j).next;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    if (depth > 0) j++;
  }
  return { text: src.slice(start, j), end: j };
}

/**
 * Every `.select(...)` argument in a file, resolved to its column string(s).
 *
 * The argument is read as a whole balanced region rather than as one leading
 * literal, so all four idioms in this codebase are covered: a plain literal,
 * `'a' + 'b'`, a ternary between two literals (`.select(withTopic ? A : B)`),
 * and a name (`.select(MEMBER_SELECT)`, `.select(this.orderSelect)`,
 * `.select(rosterColumns(withMute))`) resolved through the file's own literal
 * bindings and, failing that, any `export const` literal in the API.
 *
 * `columns` holds what could be read; `unresolved` names the arguments that
 * yielded nothing, so a new embed cannot hide behind an unreadable argument.
 */
// A name in the argument is resolved AT THE CALL SITE, through the binding
// whose scope encloses it (see `resolveBinding`), so two same-named locals in
// one file no longer collapse into one another.
function scanSelects(src: string): { columns: string[]; unresolved: string[] } {
  const bindings = literalBindings(src);
  const exported = exportedLiteralBindings();
  const columns: string[] = [];
  const unresolved: string[] = [];
  let i = 0;
  while (true) {
    const idx = src.indexOf('.select(', i);
    if (idx === -1) break;
    const start = idx + '.select('.length;
    const region = argumentRegion(src, start);
    i = region.end;
    const found: string[] = [];
    // Literals written inline in the argument.
    let j = 0;
    while (j < region.text.length) {
      const c = region.text[j];
      if (c === "'" || c === '"' || c === '`') {
        const read = readLiteral(region.text, j);
        found.push(read.value);
        j = read.next;
        continue;
      }
      j++;
    }
    // Names in the argument that are bound to a literal elsewhere, resolved
    // against the binding that is in scope AT this call site.
    for (const m of region.text.matchAll(/[A-Za-z_$][\w$]*/g)) {
      const bound = resolveBinding(bindings, m[0], start + (m.index ?? 0)) ?? exported[m[0]];
      if (bound !== undefined) found.push(bound);
    }
    if (found.length) columns.push(...found);
    else if (region.text.trim()) unresolved.push(region.text.trim().slice(0, 40));
  }
  // Column lists that reach a query as a function PARAMETER — the
  // feature-detection wrappers, `const read = (columns: string) => ...
  // .select(columns)` — cannot be traced back from the call site. Read them
  // where they are DEFINED instead: any name holding column-list text is
  // scanned wherever it is bound, so a bare embed added to `baseSelect` or
  // `GROUP_CHANNEL_COLUMNS` is caught even though its `.select()` is indirect.
  // Every binding is read, not one per name: two same-named column lists in a
  // file are two different selects, and both must be scanned.
  for (const { name, value } of bindings) {
    if (/(select|columns|cols|embed)$/i.test(name)) columns.push(value);
  }
  return { columns, unresolved };
}

/**
 * Every embed target in a select string: `[alias:]target(`. PostgREST tolerates
 * whitespace before the parenthesis (`profiles!sender_id (id, name)` is written
 * that way in supabase.ts), so the scan must too — otherwise an embed escapes
 * by being pretty-printed.
 */
function embedTargets(select: string): string[] {
  const targets: string[] = [];
  const re = /([A-Za-z_][A-Za-z0-9_]*(?:![A-Za-z0-9_]+)*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(select)) !== null) targets.push(m[1]);
  return targets;
}

function listSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) listSourceFiles(full, acc);
    else if (full.endsWith('.ts') && !full.endsWith('.test.ts')) acc.push(full);
  }
  return acc;
}

/** file-relative-path::expression -> number of unreadable select arguments. */
function scanUnresolvedSelects(): Record<string, number> {
  const ledger: Record<string, number> = {};
  for (const file of listSourceFiles(API_SRC)) {
    const rel = file.slice(API_SRC.length + 1);
    for (const expr of scanSelects(readFileSync(file, 'utf8')).unresolved) {
      const key = `${rel}::${expr}`;
      ledger[key] = (ledger[key] ?? 0) + 1;
    }
  }
  return ledger;
}

/** file-relative-path::target -> number of bare occurrences. */
function scanBareEmbeds(): Record<string, number> {
  const ledger: Record<string, number> = {};
  for (const file of listSourceFiles(API_SRC)) {
    const rel = file.slice(API_SRC.length + 1);
    const src = readFileSync(file, 'utf8');
    for (const select of extractSelectStrings(src)) {
      for (const target of embedTargets(select)) {
        if (classifyEmbed(target) !== 'bare') continue;
        const base = target.split('!')[0];
        const key = `${rel}::${base}`;
        ledger[key] = (ledger[key] ?? 0) + 1;
      }
    }
  }
  return ledger;
}

/**
 * ALLOWLIST — undisambiguated embeds that are single-FK-safe today.
 * key = `<file relative to src>::<embed target table>`, value = occurrences.
 * Grouped by why each is tolerated. Do NOT add rows to silence a new embed —
 * name the relationship at the call site instead. A row belongs here only when
 * the target relationship is genuinely single-FK AND the file is owned by
 * another lane (so it cannot be fixed from here) or carries a domain-specific
 * constraint name that must be verified at the call site, not guessed.
 */
const BARE_EMBED_ALLOWLIST: Record<string, number> = {
  // --- Aggregate embeds: `table(count)`. Reverse embeds used only to count
  //     rows; safe while the counted table has a single FK back to the source.
  // The seller-dashboard `favorites_count:` / `inquiries_count:` embeds
  // (getListingsBySeller) and the `favorites:` / `inquiries:` ones
  // (getSellerStats) moved verbatim out of supabase.ts into the marketplace
  // repository (monolith lane M1h). Same queries, new file: the rows moved with
  // them rather than any count changing — supabase.ts drops to zero for both.
  'services/data/marketplace.ts::marketplace_favorites': 2,
  'services/data/marketplace.ts::marketplace_inquiries': 2,

  // --- Marketplace listing embeds (marketplace lane owns the domain logic and
  //     the per-source constraint names). Single FK via *_listing_id today:
  //     marketplace_cart_items.listing_id (20260731170000),
  //     marketplace_orders.listing_id (20260821120000) and
  //     marketplace_orders.transaction_id (20260615140000) are each the only
  //     FK between their two tables. Counts are per resolved call site, so one
  //     shared `orderSelect` string counts once for every query that uses it.
  // R5a split routes/marketplace.ts into routes/marketplace/*; both call sites
  // are the offer→listing embeds, now in offers.ts. Same queries, new path.
  'routes/marketplace/offers.ts::marketplace_listings': 2,
  'services/marketplaceAlerts.ts::marketplace_listings': 4,
  'services/marketplaceCart.ts::marketplace_listings': 5,
  'services/marketplaceOrders.ts::marketplace_listings': 16,
  'services/marketplaceOrders.ts::marketplace_transactions': 15,
  'services/studyPackFactory.ts::marketplace_listings': 1,
  // The favourites embed (getUserFavorites) and the five inquiry embeds
  // (createInquiry, getInquiryByListingAndBuyer, getSellerInquiries,
  // getBuyerInquiries, getInquiryByThread) moved verbatim out of supabase.ts
  // into the marketplace repository (monolith lane M1h). Same queries, new
  // file: the rows moved with them rather than the count changing —
  // supabase.ts drops from 6 to zero.
  'services/data/marketplace.ts::marketplace_listings': 6,

  // --- Jobs board (jobs lane). Membership/company/posting joins, single FK
  //     each today.
  'services/jobReminders.ts::job_postings': 2,
  'services/jobsBoard.ts::job_applications': 6,
  'services/jobsBoard.ts::job_companies': 8,
  'services/jobsBoard.ts::job_postings': 13,
  'services/jobsBoard.ts::job_screening_questions': 1,

  // --- Class sections (institutionStaff / classSections lane — must not be
  //     edited from here). Single FK each today.
  'services/classSections.ts::class_sections': 1,
  'services/classSections.ts::course_topics': 1,
  'services/classSections.ts::courses': 1,
  'services/classSections.ts::marketplace_campuses': 1,

  // --- Communities. communities.ts is owned/fixed elsewhere; community_members
  //     has a single FK to communities (community_id) today. communityModeration
  //     joins groups by its single FK.
  'services/communities.ts::communities': 1,
  'services/communityModeration.ts::groups': 1,

  // --- Study/companion/library/exam joins. Each target reached by a single FK
  //     today; owned by their respective lanes.
  'services/academicCourses.ts::courses': 4,
  'services/companionContext.ts::decks': 1,
  'services/companionContext.ts::groups': 1,
  'services/examReminders.ts::courses': 1,
  'services/librarySearch.ts::decks': 1,
  'services/librarySearch.ts::notes': 1,
  'services/retentionReminders.ts::decks': 1,
  'services/topicMastery.ts::courses': 2,

  // --- supabase.ts membership joins not adjacent to the outage table pattern.
  //     group_members->groups and note_collaborators->notes are single-FK today.
  // The gamification embeds moved verbatim out of supabase.ts into the
  // gamification repository (monolith lane M1c, step 12): both
  // `user_achievements->achievements`, one `points_transactions->test_results`
  // and one leaderboard `->marketplace_listings`. Same queries, new file — the
  // rows moved with them rather than any count changing (supabase.ts drops
  // achievements entirely, marketplace_listings 7 -> 6, test_results 2 -> 1).
  'services/data/gamification.ts::achievements': 2,
  'services/data/gamification.ts::marketplace_listings': 1,
  'services/data/gamification.ts::test_results': 1,
  // `fetchGroups`' group_members->groups embed, moved verbatim out of
  // supabase.ts into the chat-send repository (monolith lane M1f, step 17) with
  // the CHAT INTERNALS section it sat in. Same query, new file: the row moved
  // with it rather than the count changing — supabase.ts drops to zero.
  'services/data/chatSend.ts::groups': 1,
  // `getPendingGroupInvitesForUser`' group_members->groups embed, moved
  // verbatim out of supabase.ts into the groups repository (monolith lane M1c,
  // step 10). Same query, new file: the row moved with it rather than the
  // count changing — supabase.ts drops from 2 to 1 for the same reason.
  'services/data/groups.ts::groups': 1,
  // `getUserGroups`' group_members->groups embed, moved verbatim out of
  // supabase.ts into the users repository (monolith lane M1b, step 6). Same
  // query, new file: the row moved with it rather than the count changing.
  'services/data/users.ts::groups': 1,
  // `getNotes`' note_collaborators->notes embed, moved verbatim out of
  // supabase.ts into the notes repository (monolith lane M1g, step 18) with
  // the NOTES section it sat in. Same query, new file: the row moved with it
  // rather than the count changing — supabase.ts drops to zero.
  'services/data/notes.ts::notes': 1,
  // All four `test_sessions->test_results` embeds now live in the tests
  // repository: two moved verbatim out of supabase.ts in monolith lane M1c
  // (step 11) and the last one — `fetchTestResults` — in lane M1h. Same
  // queries, new file: the rows moved with them rather than any count growing
  // (supabase.ts drops from 1 to zero as data/tests.ts goes from 2 to 3).
  'services/data/tests.ts::test_results': 3,

  // --- Account lifecycle export. Single FK each today.
  'services/userDataLifecycle.ts::flashcards': 1,
  'services/userDataLifecycle.ts::groups': 1,
};

describe('classifyEmbed', () => {
  it('flags a bare table-name embed', () => {
    expect(classifyEmbed('profiles')).toBe('bare');
  });

  it('flags an embed hinted only by a join modifier as still bare', () => {
    expect(classifyEmbed('profiles!inner')).toBe('bare');
    expect(classifyEmbed('groups!left')).toBe('bare');
  });

  it('accepts an embed that names a constraint or fk', () => {
    expect(classifyEmbed('profiles!community_members_user_id_fkey')).toBe('named');
    expect(classifyEmbed('profiles!community_members_user_id_fkey!inner')).toBe('named');
    expect(classifyEmbed('messages!message_bookmarks_message_id_fkey!inner')).toBe('named');
  });

  it('accepts the column form, where the target is the fk column itself', () => {
    expect(classifyEmbed('sender_id')).toBe('column-form');
    expect(classifyEmbed('group_id')).toBe('column-form');
  });
});

describe('the scanner sees real embeds', () => {
  it('parses select strings and their embed targets', () => {
    const select = 'id, sender_id, profiles:sender_id(name), groups!inner(id), notes(*)';
    expect(embedTargets(select)).toEqual(['sender_id', 'groups!inner', 'notes']);
  });
});

describe('a select name resolves through the binding that is in scope', () => {
  it('keeps two same-named locals in one file apart', () => {
    const src = [
      'function board() {',
      "  const selectClause = 'id, profiles:sender_id(name)';",
      '  return q.select(selectClause);',
      '}',
      'function listings() {',
      "  const selectClause = 'id, marketplace_listings(title)';",
      '  return q.select(selectClause);',
      '}',
    ].join('\n');
    expect(scanSelects(src)).toEqual({
      columns: ['id, profiles:sender_id(name)', 'id, marketplace_listings(title)'],
      unresolved: [],
    });
  });

  it('prefers the nearest binding and falls back to module scope', () => {
    const src = [
      "const clause = 'id, groups!inner(id)';",
      'function inner() {',
      "  const clause = 'id, group_id(name)';",
      '  return q.select(clause);',
      '}',
      'q.select(clause);',
    ].join('\n');
    expect(scanSelects(src).columns).toEqual([
      'id, group_id(name)',
      'id, groups!inner(id)',
    ]);
  });

  it('reports a name with more than one candidate in scope as unresolved, never guessed', () => {
    const src = [
      "const clause = 'id, a(b)';",
      "const clause = 'id, c(d)';",
      'q.select(clause);',
    ].join('\n');
    expect(scanSelects(src)).toEqual({ columns: [], unresolved: ['clause'] });
  });

  it('does not lose scope to a brace inside a comment, string or regex literal', () => {
    const src = [
      '// {',
      'const RE = /[{]/;',
      "const brace = '{';",
      "const clause = 'id, groups!inner(id)';",
      'function inner() {',
      "  const clause = 'id, group_id(name)';",
      '  return q.select(clause);',
      '}',
      'q.select(clause);',
    ].join('\n');
    expect(scanSelects(src).columns).toEqual([
      'id, group_id(name)',
      'id, groups!inner(id)',
    ]);
  });
});

describe('no bare PostgREST embed escapes disambiguation', () => {
  const bare = scanBareEmbeds();

  it('can read every select argument, or names the ones it cannot', () => {
    // The scan is only as good as its reach: a `.select(someExpression)` whose
    // columns it cannot resolve is a place a bare embed could hide. Resolving
    // names bound to literals covers every select in the codebase except the
    // handful below, where the columns arrive as a function PARAMETER. Each of
    // those parameters is fed from a literal binding in the same file that the
    // scan already reads, so nothing is hidden — but the ledger is frozen so a
    // NEW unreadable select argument fails here instead of silently shrinking
    // the guard's coverage.
    expect(scanUnresolvedSelects()).toEqual({
      // Each of these is a `(columns: string) => ... .select(columns)` wrapper
      // — the feature-detection retry helpers that run the same query with and
      // without a column a pending migration adds. The column list itself is a
      // named binding in the same file (SECTION_SELECT, baseSelect,
      // GROUP_CHANNEL_COLUMNS, ...), and the scan reads those AT THEIR
      // DEFINITION, so no embed hides behind the parameter.
      // aiCompanion's readHistory: one history read run twice, with and without
      // citations, from HISTORY_COLUMNS / HISTORY_COLUMNS_WITHOUT_CITATIONS in
      // the same file.
      'routes/aiCompanion.ts::columns': 1,
      'services/classSections.ts::select': 3,
      'services/communities.ts::cols': 1,
      'services/communities.ts::columns': 2,
      'services/communityModeration.ts::cols': 1,
      // boardActions' `readBoardPostRows` (`run(select)`) — the board-columns
      // and reactions capability ladders, which run the same read with and
      // without the columns migrations 20260903120000 / 20260830120000 add.
      // The argument is fed from `base` (a literal binding in the same file)
      // through `messageColumns` / `reactionColumns`, so no embed hides behind
      // the parameter. Moved here from `services/supabase.ts::select`, which
      // drops from 4 to 3, by monolith lane M1d step 15.
      'services/data/boardActions.ts::select': 1,
      // directMessages' `getDirectMessages` (`runDmPage(columns)`) — the
      // `dm_messages.reactions` capability ladder, which runs the same page
      // query with and without the column migration 20260830120000 adds. The
      // argument is fed from `baseDmSelect` (a literal binding in the same
      // file) and from `reactionColumns(baseDmSelect)`, so no embed hides
      // behind the parameter. Moved here from `services/supabase.ts::columns`,
      // which drops from 5 to 4, by monolith lane M1d step 14.
      'services/data/directMessages.ts::columns': 1,
      // offlineBundles' `getFlashcards`: `const selectClause = profile ===
      // 'compact' ? '<columns>' : '<columns>'`, a ternary between two literals
      // bound to a NAME rather than written at the call site, so the binding
      // scan (which reads `const x = '<literal>'` only) cannot follow it.
      // Neither branch contains a parenthesis, so no embed can hide there.
      //
      // It appears in this ledger only because monolith lane M1c step 9 moved
      // the method out of `services/supabase.ts`, where an UNRELATED
      // `const selectClause = \`...\`` in the chat section (line ~8548) happened
      // to bind the same name to a literal and masked it. The select itself is
      // unchanged; scoped bindings now stop that masking everywhere (see
      // `resolveBinding`).
      // groups' `getGroups` (`runList(selectClause)`) and `getGroupById`
      // (`readOne(columns)`, called twice) — the `community_surface`
      // capability ladders, which run the same query with and without the
      // column migration 20260903120000 adds. Both arguments are fed from
      // literal bindings in the same file (`baseClause`, GROUP_COLUMNS_BASE),
      // so no embed hides behind the parameter. Moved here from
      // `services/supabase.ts::columns`, which drops from 7 to 5, by monolith
      // lane M1c step 10.
      // `getGroupMessages`' `runPage(selectClause)` — the same
      // parameter-fed-wrapper idiom as the rows above: the column list is a
      // ternary between two template literals bound to `baseSelectClause`, so
      // the binding scan (which reads `const x = '<literal>'` only) cannot
      // follow it. Both branches embed `profiles!sender_id (...)`, the column
      // form, so nothing bare hides there.
      //
      // It appears in this ledger only once bindings are keyed by (name,
      // scope): the flat map used to resolve this wrapper's `selectClause`
      // through the LAST `const selectClause` in the file — the marketplace
      // fallback-search select in `buildFallbackQuery` — so the board's page
      // query was being scanned against marketplace listing columns.
      //
      // Moved here from `services/supabase.ts::selectClause`, which drops to
      // zero, by monolith lane M1e step 16: the method now lives in the group
      // messages repository, so the pin moved with the code.
      'services/data/groupMessages.ts::selectClause': 1,
      'services/data/groups.ts::columns': 2,
      'services/data/groups.ts::selectClause': 1,
      'services/data/offlineBundles.ts::selectClause': 1,
      'services/librarySearch.ts::column': 1,
      'services/moderation.ts::columns': 2,
      'services/schemaCapabilities.ts::column': 1,
      // studySets: the write helper `writeWithExamColumn` and the read helper
      // `selectSets`'s `read` both walk SET_COLUMN_LADDER, whose four rungs are
      // literal constants in the same file (SET_COLUMNS, SET_NO_EXAM_COLUMNS,
      // SET_NO_COVER_COLUMNS, SET_NO_EXAM_NO_COVER_COLUMNS) — each named so the
      // scan reads it at its definition, so no embed hides behind the ladder.
      'services/studySets.ts::columns': 5,
      // The chat section's parameter-fed select wrappers, moved verbatim out
      // of `services/supabase.ts` with the section by monolith lane M1f step
      // 17: `getGroupThread`'s `runThread(columns)` and `getPinnedMessage`'s
      // `runPinned(columns)` — the reactions / board-columns capability
      // ladders — and the three `select` wrappers behind `attachReplyPreview`,
      // `attachReplyPreviewsBatch` and `resolveThreadRootForReply`, whose
      // argument is a ternary between two literals in the same file. Every
      // branch that embeds names `profiles!sender_id` / `profiles:sender_id`,
      // the named form, so nothing bare hides behind the parameter. The rows
      // moved with the code: `services/supabase.ts::columns` drops from 4 to
      // zero and `::select` from 3 to zero.
      'services/data/chatSend.ts::columns': 4,
      'services/data/chatSend.ts::select': 3,
    });
  });

  it('matches the justified allowlist exactly — no new bare embed anywhere', () => {
    // A key present in `bare` but not the allowlist is a NEW bare embed: name
    // its constraint/fk at the call site (`target!some_fkey(...)`), do not add
    // a row here. A count higher than the allowlist means one more bare embed
    // to an already-listed target. A count lower means you fixed one — decrement
    // (or delete) its allowlist row to keep this ledger honest.
    expect(bare).toEqual(BARE_EMBED_ALLOWLIST);
  });

  it('never tolerates a bare embed of profiles from community_members (the outage)', () => {
    const communities = readFileSync(join(API_SRC, 'services/communities.ts'), 'utf8');
    for (const select of extractSelectStrings(communities)) {
      for (const target of embedTargets(select)) {
        if (target.split('!')[0] === 'profiles') {
          expect(classifyEmbed(target)).toBe('named');
        }
      }
    }
  });

  it('keeps the two embeds that were fixed alongside the outage named', () => {
    const supabase = readFileSync(join(API_SRC, 'services/supabase.ts'), 'utf8');
    // The message_bookmarks -> messages embed moved verbatim into the board
    // repository with `getBookmarkedMessageIdsForGroup` (monolith lane M1d,
    // step 15), so it is pinned where the query now lives. The pin moved with
    // the code; neither embed stopped being checked.
    const boardActions = readFileSync(
      join(API_SRC, 'services/data/boardActions.ts'),
      'utf8',
    );
    // note_collaborators -> profiles and message_bookmarks -> messages were the
    // two latent single-FK embeds fixed with the guard. If either reverts to a
    // bare form it will reappear in the scan; pin the named forms directly too.
    // The note_collaborators -> profiles embed moved verbatim into the notes
    // repository with `getNoteCollaborators` (monolith lane M1g, step 18), so
    // it is pinned where the query now lives. The pin moved with the code;
    // neither embed stopped being checked.
    const notes = readFileSync(join(API_SRC, 'services/data/notes.ts'), 'utf8');
    expect(notes).toContain('profiles!note_collaborators_user_id_fkey(');
    expect(boardActions).toContain('messages!message_bookmarks_message_id_fkey!inner(');
    expect(notes).not.toContain('.select("*, profiles(id, name, avatar_url)")');
    expect(boardActions).not.toContain('.select("message_id, messages!inner(group_id)")');
  });
});
