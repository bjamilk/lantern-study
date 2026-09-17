#!/usr/bin/env node
/**
 * extract-test-assertions.mjs — the proof that a harness change is ONLY a
 * harness change.
 *
 * Written for monolith lane M3, Phase B, PR 3, which retargeted 31 suites off
 * `SupabaseService.prototype` onto the data modules. The risk in that edit is
 * not that a test breaks — it is that a test quietly starts asserting
 * something else. So: extract every `describe`/`it` title and every line
 * containing `expect(`, in order, one per line, before and after, and diff.
 *
 * Usage:
 *   OUT_DIR=/tmp/before node scripts/extract-test-assertions.mjs src/**\/*.test.ts
 *   …make the change…
 *   OUT_DIR=/tmp/after  node scripts/extract-test-assertions.mjs src/**\/*.test.ts
 *   diff -r /tmp/before /tmp/after
 *
 * A diff is not automatically wrong — a call written INSIDE `expect(...)` has
 * to change when the call changes — but it is always something to explain in
 * the pull request.
 */
import fs from 'fs';
import path from 'path';

const files = process.argv.slice(2);
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const out = [];
  const lines = src.split('\n');
  for (const line of lines) {
    const title = line.match(/^\s*(?:it|test)(?:\.each\([^)]*\))?\s*(?:\.(?:only|skip|todo))?\s*\(\s*(['"`])(.*?)\1/);
    if (title) out.push(`TITLE ${title[2]}`);
    const describeTitle = line.match(/^\s*describe\s*(?:\.(?:only|skip))?\s*\(\s*(['"`])(.*?)\1/);
    if (describeTitle) out.push(`DESCRIBE ${describeTitle[2]}`);
    if (/\bexpect\s*\(/.test(line)) out.push(`EXPECT ${line.trim()}`);
  }
  const name = path.basename(file);
  fs.writeFileSync(path.join(process.env.OUT_DIR, name + '.txt'), out.join('\n') + '\n');
}
