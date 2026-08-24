/**
 * /api/v1/library route surface (Phase 1 · B).
 *
 * Pins the query validation the clients rely on — q shorter than 2 chars,
 * a malformed courseId or topicId, an unknown type or an out-of-range limit are
 * 400s before the service runs — and that both routes are registered.
 */
import { validationResult } from 'express-validator';
import router, { validateLibrarySearch } from './library';

async function runSearchValidators(query: Record<string, unknown>) {
  const req = { query } as any;
  for (const validator of validateLibrarySearch) {
    await validator.run(req);
  }
  return { result: validationResult(req), req };
}

const failedParam = (result: ReturnType<typeof validationResult>, name: string) =>
  result.array().some((e) => 'path' in e && e.path === name);

const registered = (method: 'get' | 'post') =>
  (router as any).stack
    .filter((layer: any) => layer.route?.methods?.[method])
    .map((layer: any) => layer.route.path);

describe('validateLibrarySearch', () => {
  it('accepts a well-formed search', async () => {
    const { result } = await runSearchValidators({
      q: 'genetics',
      courseId: '11111111-1111-4111-8111-111111111111',
      topicId: '22222222-2222-4222-8222-222222222222',
      types: 'notes,flashcards',
      limit: '50',
    });
    expect(result.isEmpty()).toBe(true);
  });

  it('accepts courseId=null (unfiled) and omitted optionals', async () => {
    const { result } = await runSearchValidators({ q: 'ab', courseId: 'null' });
    expect(result.isEmpty()).toBe(true);
  });

  it('accepts topicId on its own (a topic implies its course) and topicId=null', async () => {
    const alone = await runSearchValidators({ q: 'ab', topicId: '22222222-2222-4222-8222-222222222222' });
    expect(alone.result.isEmpty()).toBe(true);
    const untopiced = await runSearchValidators({ q: 'ab', topicId: 'null' });
    expect(untopiced.result.isEmpty()).toBe(true);
  });

  it('rejects q shorter than 2 characters — also after sanitising delimiters/whitespace', async () => {
    for (const q of ['a', ' ', ',,', '"(x)"']) {
      const { result } = await runSearchValidators({ q });
      expect(result.isEmpty()).toBe(false);
      expect(failedParam(result, 'q')).toBe(true);
    }
    const missing = await runSearchValidators({});
    expect(failedParam(missing.result, 'q')).toBe(true);
  });

  it('normalises q in place so the handler sees the sanitised value', async () => {
    const { result, req } = await runSearchValidators({ q: '  mth,(101)  ' });
    expect(result.isEmpty()).toBe(true);
    expect(req.query.q).toBe('mth 101');
  });

  it.each([
    ['courseId', 'not-a-uuid'],
    ['courseId', '123'],
    ['topicId', 'not-a-uuid'],
    ['topicId', 'none'],
    ['types', 'notes,tests'],
    ['types', 'everything'],
    ['limit', '0'],
    ['limit', '51'],
    ['limit', 'ten'],
  ])('rejects a bad %s (%j)', async (field, value) => {
    const { result } = await runSearchValidators({ q: 'genetics', [field]: value });
    expect(result.isEmpty()).toBe(false);
    expect(failedParam(result, field)).toBe(true);
  });
});

describe('library router', () => {
  it('registers GET /overview and GET /search', () => {
    expect(registered('get')).toEqual(expect.arrayContaining(['/overview', '/search']));
    expect(registered('post')).toEqual([]);
  });
});
