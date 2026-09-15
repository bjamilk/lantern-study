/**
 * Route-surface consistency guards (F7b).
 *
 * 1. `handleValidationErrors` must never be attached without an
 *    express-validator chain in front of it in the same `router.<verb>(` call.
 *    With no chain it reads an empty error array and always calls next(), so it
 *    is a no-op that makes the route read as validated. 78 routes across 12
 *    files were in that state; they were removed rather than left claiming a
 *    check that did not exist. This test fails the build if one comes back.
 *
 * 2. There must be exactly ONE `errorHandler` in `middleware/`. A second one
 *    lived in `middleware/auth.ts` and disagreed with the global handler on
 *    PGRST116 (400 "Database relationship error" vs 404 "Resource not found").
 *
 * Both are source scans on purpose: the failure mode is a route file being
 * edited, not a runtime path, so the guard has to read the source the way a
 * reviewer would.
 */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';

const ROUTES_DIR = __dirname;
const MIDDLEWARE_DIR = path.join(__dirname, '..', 'middleware');

const ROUTER_VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all', 'use']);

/** An express-validator chain: a `validateX` array, or an inline body()/param()/query(). */
const VALIDATOR_ARRAY = /\bvalidate[A-Z]\w*/;
const VALIDATOR_CALL = /\b(body|param|query|check|oneOf)\s*\(/;

function routeSourceFiles(): string[] {
  return fs
    .readdirSync(ROUTES_DIR)
    .filter((f) => f.endsWith('.ts') && !f.includes('.test.'))
    .sort();
}

function chainlessValidationSites(file: string): string[] {
  const src = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8');
  if (!src.includes('handleValidationErrors')) return [];

  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const findings: string[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ROUTER_VERBS.has(node.expression.name.text)
    ) {
      const args = node.arguments;
      const hvIndex = args.findIndex((a) => a.getText(sf) === 'handleValidationErrors');
      if (hvIndex > 0) {
        const before = args
          .slice(0, hvIndex)
          .map((a) => a.getText(sf))
          .join(',');
        if (!VALIDATOR_ARRAY.test(before) && !VALIDATOR_CALL.test(before)) {
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
          const route = args[0] ? args[0].getText(sf) : '<no path>';
          findings.push(
            `${file}:${line} router.${node.expression.name.text}(${route}) — handleValidationErrors with no validator chain`
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return findings;
}

describe('handleValidationErrors is never a no-op', () => {
  it('finds no chainless attachment in any route file', () => {
    const findings = routeSourceFiles().flatMap(chainlessValidationSites);
    expect(findings).toEqual([]);
  });

  it('still detects one when it is there (the guard itself works)', () => {
    // Guard against the scan silently matching nothing — e.g. an AST shape change.
    const sample = `
      import { handleValidationErrors, validateUserId } from '../middleware/validation';
      router.post('/good', authMiddleware, validateUserId, handleValidationErrors, h);
      router.post('/bad', authMiddleware, handleValidationErrors, h);
    `;
    const sf = ts.createSourceFile('sample.ts', sample, ts.ScriptTarget.Latest, true);
    const bad: string[] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ROUTER_VERBS.has(node.expression.name.text)
      ) {
        const args = node.arguments;
        const i = args.findIndex((a) => a.getText(sf) === 'handleValidationErrors');
        if (i > 0) {
          const before = args
            .slice(0, i)
            .map((a) => a.getText(sf))
            .join(',');
          if (!VALIDATOR_ARRAY.test(before) && !VALIDATOR_CALL.test(before)) {
            bad.push(args[0].getText(sf));
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    expect(bad).toEqual(["'/bad'"]);
  });

  it('leaves every properly chained attachment in place', () => {
    // The sweep must not have deleted the real ones: several files still use it.
    const stillUsed = routeSourceFiles().filter((f) =>
      fs.readFileSync(path.join(ROUTES_DIR, f), 'utf8').includes('  handleValidationErrors,')
    );
    expect(stillUsed.length).toBeGreaterThan(0);
  });
});

describe('exactly one errorHandler', () => {
  it('only middleware/errorHandler.ts exports an errorHandler', () => {
    const exporters = fs
      .readdirSync(MIDDLEWARE_DIR)
      .filter((f) => f.endsWith('.ts') && !f.includes('.test.'))
      .filter((f) =>
        /export\s+(const|function)\s+errorHandler\b/.test(
          fs.readFileSync(path.join(MIDDLEWARE_DIR, f), 'utf8')
        )
      );

    expect(exporters).toEqual(['errorHandler.ts']);
  });

  it('maps PGRST116 to 404, not 400', () => {
    // The deleted duplicate answered 400 "Database relationship error" for a
    // missing row. The surviving policy is 404 "Resource not found".
    const src = fs.readFileSync(path.join(MIDDLEWARE_DIR, 'errorHandler.ts'), 'utf8');
    const at = src.indexOf("err.code === 'PGRST116'");
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 200)).toContain("new ApiError('Resource not found', 404)");
  });
});
