/**
 * A ratchet on discarded write errors (#108).
 *
 * ## Why this exists
 *
 * supabase-js RESOLVES with `{ data, error }` on a failed write, so
 *
 *   await db.from('marketplace_orders').update(patch).eq('id', id);
 *
 * ignores failure, and a `try/catch` around it catches nothing. 87 of these
 * are in the tree today; `docs/write-errors-plan.md` classifies them. Fixing
 * them is several pull requests of careful, money-path work, so the number is
 * frozen here and this test fails on any INCREASE — and on any decrease too,
 * so a gain is banked rather than quietly given back later.
 *
 * ## What counts as discarded
 *
 * A statement whose result is thrown away: it neither destructures (`const {
 * error } = await …`) nor returns, assigns or passes the promise anywhere. The
 * two edge shapes both appear in the tree and are both self-tested below:
 *
 *  - `…insert({…}).then(({ error }) => …)` IS a check (data/boardActions.ts);
 *  - `…update({…}).then(undefined, handler)` is NOT — nothing ever rejects, so
 *    the rejection handler can never fire (marketplaceOrders.ts).
 *
 * The GoTrue shape is counted too: `auth.admin.signOut` / `updateUserById` /
 * `deleteUser` resolve with `{ error }` exactly like a table write, which the
 * `.from(` regex cannot see. It is the case #110 found and marked.
 *
 * ## Banking a gain
 *
 * When a pull request fixes sites, re-freeze with
 *
 *   UPDATE_BASELINE=1 npx jest src/services/data/discardedWrites.test.ts
 *
 * and commit the changed `discardedWrites.baseline.json` alongside the fix.
 *
 * ## The gotcha
 *
 * A scanner that silently stops matching passes forever. The last describe
 * block feeds the matcher positive and negative fixtures, and the totals below
 * are asserted to be non-trivial, so regex rot fails loudly.
 */
import fs from 'fs';
import path from 'path';

const SRC_ROOT = path.join(__dirname, '..', '..');
const BASELINE_PATH = path.join(__dirname, 'discardedWrites.baseline.json');

/**
 * Directories under `src` that hold server code. `services/data/testStub.ts`
 * and friends are ordinary source and ARE scanned; only `*.test.ts` is not.
 */
const SCANNED = ['routes', 'services', 'middleware', 'queue', 'utils'];

const TABLE_WRITE = /\.from\(\s*['"][\w]+['"]\s*\)[\s\S]*\.(insert|update|upsert|delete)\(/;
const GOTRUE_WRITE = /\bauth\.admin\.(signOut|updateUserById|deleteUser|createUser|inviteUserByEmail|generateLink)\(/;

/**
 * Is this awaited statement's result discarded?
 *
 * `statement` is the text between `await` and the terminating `;`. The caller
 * has already established that the statement began at the start of a line with
 * a bare `await` — nothing assigned, nothing returned.
 */
export function isDiscardedWrite(statement: string): boolean {
  if (!TABLE_WRITE.test(statement) && !GOTRUE_WRITE.test(statement)) return false;
  // `.then(handler)` reads the resolved value — unless the fulfilment handler
  // is `undefined`, in which case only a rejection (which never comes) would
  // be seen.
  const then = /\.then\(\s*([\s\S]*?)(?:,|\))/.exec(statement);
  if (then) {
    const first = then[1].trim();
    if (first && first !== 'undefined' && first !== 'null') return false;
  }
  // `.catch(…)` alone is the same dead handler as `.then(undefined, …)`.
  return true;
}

function sourceFiles(dir: string, found: string[] = []): string[] {
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      sourceFiles(full, found);
      continue;
    }
    if (!entry.name.endsWith('.ts')) continue;
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.d.ts')) continue;
    found.push(full);
  }
  return found;
}

/**
 * Is the `await` at `index` the start of a STATEMENT, rather than an
 * expression handed to something?
 *
 * The fixed shape puts the awaited write on its own line inside a call —
 *
 *   mustWrite(
 *     await db.from('t').update(patch).eq('id', id),
 *     ctx,
 *   );
 *
 * — so "first thing on the line" is not enough: the result IS read, by the
 * helper. A statement's `await` follows a statement boundary; an expression's
 * follows an opening bracket, a comma or an operator.
 */
export function startsAStatement(src: string, index: number): boolean {
  let i = index - 1;
  while (i >= 0 && /\s/.test(src[i])) i -= 1;
  if (i < 0) return true;
  return !'(,=>:?&|+['.includes(src[i]);
}

/** `file → line numbers`, for the whole scanned tree. */
export function scan(): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  const files = SCANNED.flatMap((dir) => sourceFiles(path.join(SRC_ROOT, dir)));
  for (const file of files) {
    const relative = path.relative(SRC_ROOT, file).split(path.sep).join('/');
    const src = fs.readFileSync(file, 'utf8');
    // A bare awaited statement: start of a line, only whitespace before
    // `await`, up to the first `;`.
    const statements = /(?:^|\n)([ \t]*)await\s+([\s\S]*?);/g;
    let match: RegExpExecArray | null;
    while ((match = statements.exec(src))) {
      const awaitAt = match.index + (match[0].startsWith('\n') ? 1 : 0) + match[1].length;
      if (!startsAStatement(src, awaitAt)) continue;
      if (!isDiscardedWrite(match[2])) continue;
      const line = src.slice(0, match.index + 1).split('\n').length;
      (out[relative] ||= []).push(line);
    }
  }
  return out;
}

function counts(found: Record<string, number[]>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(found)
      .map(([file, lines]) => [file, lines.length] as const)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

const found = scan();
const current = counts(found);

if (process.env.UPDATE_BASELINE === '1') {
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(current, null, 2)}\n`);
}

const baseline: Record<string, number> = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));

const REBASE = 'run with UPDATE_BASELINE=1 to bank the gain, and commit discardedWrites.baseline.json';

describe('discarded write errors do not grow', () => {
  it('has no new file with a discarded write', () => {
    const added = Object.keys(current).filter((file) => !(file in baseline));
    expect({ added, hint: added.length ? 'these files newly discard a write error' : '' }).toEqual({
      added: [],
      hint: '',
    });
  });

  it('has no file with MORE discarded writes than the baseline', () => {
    const worse = Object.entries(current)
      .filter(([file, count]) => file in baseline && count > baseline[file])
      .map(([file, count]) => `${file}: ${baseline[file]} → ${count} (lines ${found[file].join(', ')})`);
    expect(worse).toEqual([]);
  });

  it('has no file with FEWER discarded writes than the baseline', () => {
    // A decrease is good news that has to be banked, or the ratchet quietly
    // allows it to be given back in a later pull request.
    const better = Object.entries(baseline)
      .filter(([file, count]) => (current[file] ?? 0) < count)
      .map(([file, count]) => `${file}: ${count} → ${current[file] ?? 0}`);
    expect({ better, hint: better.length ? REBASE : '' }).toEqual({ better: [], hint: '' });
  });

  it('actually scans the tree it claims to', () => {
    // Guards the failure mode where a bad root or a rotted regex makes every
    // assertion above vacuously true.
    const files = SCANNED.flatMap((dir) => sourceFiles(path.join(SRC_ROOT, dir)));
    expect(files.length).toBeGreaterThan(200);
    const total = Object.values(current).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(50);
    expect(Object.keys(current)).toContain('services/marketplacePayments.ts');
  });
});

describe('the matcher recognises what it is for', () => {
  const discarded = [
    // The original #107 / #108 shape.
    "db.from('companion_analytics').insert({ user_id: id })",
    // Multi-line, filtered, the money-path shape.
    "this.db\n  .from('marketplace_orders')\n  .update({ payment_id: p })\n  .eq('id', id)",
    "this.db.from('marketplace_cart_items').delete().eq('buyer_id', b)",
    "this.db.from('x').upsert({ a: 1 }, { onConflict: 'a' })",
    // A rejection handler on something that never rejects (marketplaceOrders).
    "this.db.from('marketplace_orders').update({ n: 1 }).then(undefined, (e) => log(e))",
    // GoTrue resolves with `{ error }` too (#110).
    "client.auth.admin.signOut(userId, 'global')",
    '(supabase as any).auth.admin.updateUserById(id, { ban_duration: d })',
  ];
  const fine = [
    // Reads are not writes.
    "db.from('marketplace_orders').select('*').eq('id', id)",
    // A fulfilment handler DOES see the error (data/boardActions).
    "db.from('chat_message_audit').insert({ a: 1 }).then(({ error }) => { if (error) throw error; })",
    // Not a supabase call at all.
    'this.orders.notifyOrderParty(sellerId, payload)',
    'cacheService.delete(key)',
    // A GoTrue read.
    'client.auth.admin.getUserById(userId)',
  ];

  it.each(discarded)('counts %s', (statement) => {
    expect(isDiscardedWrite(statement)).toBe(true);
  });

  it.each(fine)('leaves %s alone', (statement) => {
    expect(isDiscardedWrite(statement)).toBe(false);
  });

  it('only considers BARE awaits, so a destructured write is never counted', () => {
    // The scan's own statement regex is what enforces this; pin it directly so
    // a change to it cannot start counting checked writes.
    const src = "const { error } = await db.from('t').insert({ a: 1 });\n";
    const statements = /(?:^|\n)([ \t]*)await\s+([\s\S]*?);/g;
    expect(statements.exec(src)).toBeNull();
  });

  it('does not count a write handed to mustWrite / bestEffortWrite', () => {
    // The fixed shape puts the awaited write on its own line INSIDE a call, so
    // it is first on its line and would be counted without the statement check.
    const fixed = [
      "mustWrite(\n  await db.from('marketplace_orders').update(patch).eq('id', id),\n  ctx,\n);",
      "bestEffortWrite(\n  await db.from('marketplace_payments').update(p).eq('id', id),\n  ctx,\n);",
    ];
    for (const src of fixed) {
      const at = src.indexOf('await');
      expect(startsAStatement(src, at)).toBe(false);
    }
    // …and a genuine statement still reads as one, after `;`, `{` and `}`.
    for (const src of ['a();\nawait db.from(…)', '{\n  await db.from(…)', '}\nawait db.from(…)']) {
      expect(startsAStatement(src, src.indexOf('await'))).toBe(true);
    }
  });
});
