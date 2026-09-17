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
 * ## The four shapes it counts
 *
 *  1. `bare` — a bare awaited `.from('t').update(…)` statement, the original.
 *     Includes the GoTrue writes (`auth.admin.signOut` / `updateUserById` /
 *     `deleteUser`), which resolve with `{ error }` exactly like a table write
 *     and which the `.from(` regex cannot see (#110).
 *  2. `helper` — a bare awaited call to a function whose own return type says
 *     it RESOLVES with `{ error }` rather than throwing. `signOutUserGlobally`
 *     (#110) and `updateOrderFieldsAsParty` (#111) are both this.
 *  3. `chain` — a write chain parked in a variable and awaited through an
 *     expression, so the awaited text names no table:
 *     `await (isSeller ? scoped.eq(…) : scoped.eq(…))` (#111).
 *  4. `unread` — a write whose result IS destructured but whose `error` is
 *     never read again in the enclosing scope, or is not bound at all. There
 *     are none today: this codebase checks when it destructures.
 *
 * Two edge shapes are self-tested below because both appear in the tree:
 * `…insert({…}).then(({ error }) => …)` IS a check (data/boardActions.ts),
 * while `…update({…}).then(undefined, handler)` is NOT, because nothing ever
 * rejects (marketplaceOrders.ts).
 *
 * ## What it CANNOT catch — the count is a floor, not a total
 *
 *  - A write reached through a value whose type the scan cannot follow: a
 *    helper with no return-type annotation, one typed through an alias or an
 *    interface method, or a chain passed as an argument and awaited elsewhere.
 *  - A discarded error that crosses a file boundary in any other way — a
 *    promise returned, stored, and awaited by a caller that ignores it.
 *  - `Promise.all([...writes])`, where the array elements are not statements.
 *  - A destructured `error` that is "read" only in dead code (`if (false)`), or
 *    read in a nested closure the scope walk mis-bounds.
 *  - Anything under `apps/api-server/src` outside SCANNED, and any `.test.ts`.
 *
 * A shape that is found later is added as a detector, which RAISES the
 * baseline in the same commit; that is expected and is not a regression.
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

/**
 * Blank out comments and string bodies, keeping every offset and newline, so
 * line numbers still line up.
 *
 * This is not a nicety. `marketplacePayments.ts` has a comment reading
 * "…opened against; settlement refuses…", and the scan's "up to the first `;`"
 * rule ended three payment-row inserts inside that comment — which made three
 * writes that DO check their error read as unchecked. A `;` or a brace in a
 * comment, a URL's `//`, or a `}` in a template literal all corrupt the scan
 * the same way.
 */
export function blankNonCode(src: string): string {
  const out = src.split('');
  const blank = (from: number, to: number) => {
    for (let i = from; i < to && i < out.length; i += 1) if (out[i] !== '\n') out[i] = ' ';
  };
  let i = 0;
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === '//') {
      const end = src.indexOf('\n', i);
      blank(i, end === -1 ? src.length : end);
      i = end === -1 ? src.length : end;
      continue;
    }
    if (two === '/*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    const quote = src[i];
    if (quote === '"' || quote === "'" || quote === '`') {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === quote) break;
        j += 1;
      }
      // A string body KEEPS its text — `.from('marketplace_orders')` has to
      // stay recognisable — and loses only the three characters that steer the
      // scan: a statement terminator and the braces the scope walk counts.
      for (let k = i + 1; k < j; k += 1) if (';{}'.includes(out[k])) out[k] = ' ';
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return out.join('');
}

/**
 * The text from `index` to the end of the block that encloses it — used to ask
 * "is this destructured `error` ever read?".
 *
 * A brace counter, not a parser: a brace inside a string or a comment can end
 * the window early. Ending EARLY finds fewer reads, so it over-counts rather
 * than under-counts, which is the safe direction for a floor.
 */
export function enclosingScopeAfter(src: string, index: number): string {
  let depth = 0;
  for (let i = index; i < src.length; i += 1) {
    const char = src[i];
    if (char === '{') depth += 1;
    else if (char === '}') {
      if (depth === 0) return src.slice(index, i);
      depth -= 1;
    }
  }
  return src.slice(index);
}

/**
 * Names of functions that RESOLVE with `{ error }` rather than throwing, taken
 * from their own return-type annotation (`: Promise<{ error: any }>`). A bare
 * `await thatFunction(…)` discards a failure exactly like a bare table write,
 * and no `.from(` appears at the call site for a regex to find.
 *
 * `signOutUserGlobally` (#110) and `updateOrderFieldsAsParty` (#111) are both
 * this shape.
 */
export function errorReturningHelpers(sources: Array<{ src: string }>): Set<string> {
  const names = new Set<string>();
  const declaration = /(?:function|const)\s+([A-Za-z_$][\w$]*)[\s\S]{0,600}?:\s*Promise<\{\s*error\b/g;
  for (const { src } of sources) {
    let match: RegExpExecArray | null;
    while ((match = declaration.exec(src))) names.add(match[1]);
  }
  return names;
}

/**
 * Identifiers a write CHAIN was parked in, so the write happens through a
 * variable and the awaited expression names no table — the shape R2 found in
 * `updateOrderFieldsAsParty`:
 *
 *   const scoped = supabase.from("marketplace_orders").update(patch).eq(…);
 *   await (isSeller ? scoped.eq("seller_id", id) : scoped.eq("buyer_id", id));
 */
export function chainVariables(src: string): Set<string> {
  const names = new Set<string>();
  const assignment = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]*?);/g;
  let match: RegExpExecArray | null;
  while ((match = assignment.exec(src))) {
    const rhs = match[2];
    if (rhs.includes('await')) continue; // already resolved, not a chain
    // A FUNCTION that performs a write is not a parked chain: awaiting a call
    // to it is an ordinary call, and `const clearPins = () => db.from(…)…` in
    // data/chatSend.ts read as one until this line existed.
    if (rhs.includes('=>') || /^\s*(?:async\s+)?function\b/.test(rhs)) continue;
    if (TABLE_WRITE.test(rhs)) names.add(match[1]);
  }
  return names;
}

export type Finding = { line: number; kind: 'bare' | 'helper' | 'chain' | 'unread' };

/** `file → findings`, for the whole scanned tree. */
export function scan(): Record<string, Finding[]> {
  const out: Record<string, Finding[]> = {};
  const files = SCANNED.flatMap((dir) => sourceFiles(path.join(SRC_ROOT, dir)));
  const loaded = files.map((file) => ({
    file,
    relative: path.relative(SRC_ROOT, file).split(path.sep).join('/'),
    src: blankNonCode(fs.readFileSync(file, 'utf8')),
  }));
  const helpers = errorReturningHelpers(loaded);
  const helperCall = helpers.size
    ? new RegExp(`\\b(?:${[...helpers].join('|')})\\s*\\(`)
    : /$a^/;

  for (const { relative, src } of loaded) {
    const add = (index: number, kind: Finding['kind']) => {
      (out[relative] ||= []).push({ line: src.slice(0, index + 1).split('\n').length, kind });
    };
    const chains = chainVariables(src);
    const chainUse = chains.size ? new RegExp(`\\b(?:${[...chains].join('|')})\\b`) : /$a^/;

    // 1–3. A bare awaited statement: start of a line, only whitespace before
    // `await`, up to the first `;`.
    const statements = /(?:^|\n)([ \t]*)await\s+([\s\S]*?);/g;
    let match: RegExpExecArray | null;
    while ((match = statements.exec(src))) {
      const awaitAt = match.index + (match[0].startsWith('\n') ? 1 : 0) + match[1].length;
      if (!startsAStatement(src, awaitAt)) continue;
      const statement = match[2];
      if (isDiscardedWrite(statement)) add(match.index, 'bare');
      else if (helperCall.test(statement)) add(match.index, 'helper');
      else if (chainUse.test(statement)) add(match.index, 'chain');
    }

    // 4. A destructured write whose `error` is bound and never read — or not
    //    bound at all.
    const destructured = /(?:^|\n)[ \t]*(?:const|let)\s*\{([^}]*)\}\s*=\s*await\s+([\s\S]*?);/g;
    while ((match = destructured.exec(src))) {
      const statement = match[2];
      const isWrite =
        TABLE_WRITE.test(statement) || GOTRUE_WRITE.test(statement) || helperCall.test(statement);
      if (!isWrite) continue;
      const binding = match[1]
        .split(',')
        .map((part) => part.trim())
        .find((part) => /^error\b/.test(part));
      if (!binding) {
        add(match.index, 'unread');
        continue;
      }
      const name = binding.includes(':') ? binding.split(':')[1].trim() : 'error';
      const after = enclosingScopeAfter(src, match.index + match[0].length);
      if (!new RegExp(`\\b${name}\\b`).test(after)) add(match.index, 'unread');
    }
  }
  return out;
}

function counts(found: Record<string, Finding[]>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(found)
      .map(([file, findings]) => [file, findings.length] as const)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

function describeFindings(findings: Finding[]): string {
  return findings.map((finding) => `${finding.kind}@${finding.line}`).join(', ');
}

const found = scan();
const current = counts(found);

if (process.env.UPDATE_BASELINE === '1') {
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(current, null, 2)}\n`);
  // Re-freezing is also when someone wants to see WHAT is left, by shape.
  for (const [file, findings] of Object.entries(found)) {
    // eslint-disable-next-line no-console
    console.log(`${file}: ${describeFindings(findings)}`);
  }
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
      .map(([file, count]) => `${file}: ${baseline[file]} → ${count} (${describeFindings(found[file])})`);
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

  it('still finds the shape the bare-await regex cannot see', () => {
    // `await dataLayer.users.signOutUserGlobally(id)` (#110) and
    // `await dataLayer.marketplace.updateOrderFieldsAsParty(…)` (#111) are both
    // bare awaits of a helper that RESOLVES with `{ error }`. If this reaches
    // zero because the detector rotted rather than because the sites were
    // fixed, the ratchet's decrease check fires first — this says which shape
    // went missing.
    const kinds = Object.values(found).flat().map((finding) => finding.kind);
    expect(kinds).toContain('helper');
    // `chain` has no site in the tree right now: #111 moved the one R2 found
    // (`await (isSeller ? scoped.eq(…) : scoped.eq(…))`) behind
    // `updateOrderFieldsAsParty`, which is the `helper` shape. The detector
    // stays, with a fixture instead of a live site — the pattern is easy to
    // write again.
    expect(kinds).not.toContain('chain');
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

  it('blanks comments and string bodies without moving a single offset', () => {
    // The bug this exists for: a `;` inside a comment ended three payment-row
    // inserts early, and three writes that DO check their error read as
    // unchecked.
    const src = [
      'const a = 1; // opened against; settlement refuses',
      'const url = "https://x/y"; /* a } brace ; in a block */',
      'const q = `text with } and ; inside`;',
    ].join('\n');
    const blanked = blankNonCode(src);
    expect(blanked.length).toBe(src.length);
    expect(blanked.split('\n')).toHaveLength(3);
    expect(blanked).not.toContain('settlement');
    expect(blanked).not.toContain('brace');
    // A `//` inside a STRING is not a comment.
    expect(blanked).toContain('https://x/y');
    // Braces and terminators inside a string body are gone; its text is not.
    expect(blanked).toContain('text with');
    const template = blanked.slice(blanked.indexOf('`') + 1, blanked.lastIndexOf('`'));
    expect(template).not.toContain('}');
    expect(template).not.toContain(';');
    // A table literal has to stay readable, or every detector goes blind.
    expect(blankNonCode(`db.from('marketplace_orders').update(p)`)).toContain(
      "from('marketplace_orders')",
    );
  });

  it('reads an enclosing scope up to the brace that closes it', () => {
    const src = 'const { error } = await w(); if (x) { y(); } log(error); } after';
    const after = enclosingScopeAfter(src, src.indexOf('if'));
    expect(after).toContain('log(error)');
    expect(after).not.toContain('after');
  });

  it('knows which helpers resolve with an error instead of throwing', () => {
    const names = errorReturningHelpers([
      {
        src: [
          'export async function signOutUserGlobally(a: X, b: string): Promise<{ error: any }> {}',
          'export async function updateOrderFieldsAsParty(',
          '  supabase: DataClient,',
          '  orderId: string,',
          '): Promise<{ error: any }> {}',
          'export async function getOrder(id: string): Promise<Order | null> {}',
        ].join('\n'),
      },
    ]);
    expect([...names].sort()).toEqual(['signOutUserGlobally', 'updateOrderFieldsAsParty']);
  });

  it('spots a write chain parked in a variable, and not a function that writes', () => {
    // The shape R2 found in `updateOrderFieldsAsParty` before #111 moved it:
    // the awaited expression names no table, so only the assignment gives it
    // away.
    const parked = [
      'const scoped = supabase',
      '  .from("marketplace_orders")',
      '  .update(fieldUpdates)',
      '  .eq("id", orderId);',
      'await (isSeller ? scoped.eq("seller_id", id) : scoped.eq("buyer_id", id));',
    ].join('\n');
    expect([...chainVariables(parked)]).toEqual(['scoped']);
    // A FUNCTION that performs a write is not a parked chain — awaiting a call
    // to it is an ordinary call. `const clearPins = () => …` in data/chatSend.ts
    // read as one until the detector excluded these.
    const fn = 'const clearPins = () => supabase.from("messages").update({ pinned: false });';
    expect([...chainVariables(fn)]).toEqual([]);
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
