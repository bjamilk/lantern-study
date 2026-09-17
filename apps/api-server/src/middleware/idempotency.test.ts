import { idempotencyMiddleware, setIdempotencyClient } from './idempotency';
import * as idempotencyService from '../services/idempotency';

describe('idempotencyMiddleware', () => {
  beforeEach(() => {
    setIdempotencyClient(() => ({}) as any);
  });

  it('rejects when requireKey and header missing', () => {
    const mw = idempotencyMiddleware({ operation: 'test_op', requireKey: true });
    const req: any = { user: { id: 'u1' }, headers: {} };
    const res: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    mw(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Idempotency-Key header is required',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('attaches runIdempotent that delegates to withIdempotency', async () => {
    const spy = jest
      .spyOn(idempotencyService, 'withIdempotency')
      .mockResolvedValue({ cached: true } as any);

    const mw = idempotencyMiddleware({ operation: 'test_op' });
    const req: any = {
      user: { id: 'u1' },
      headers: { 'idempotency-key': 'abc' },
    };
    const res: any = {};
    const next = jest.fn();

    mw(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.idempotencyKey).toBe('abc');
    const result = await req.runIdempotent(async () => ({ x: 1 }));
    expect(spy).toHaveBeenCalled();
    expect(result).toEqual({ cached: true });
    spy.mockRestore();
  });

  /**
   * #117. The lease's per-route policy is only as good as its plumbing: a route
   * that declares `leaseReclaim` and never has it forwarded would silently get
   * the default, and the declaration would be decoration.
   */
  it.each([
    ['forwards leaseReclaim when the route opts in', true, true],
    ['leaves it undefined when the route stays on the default', undefined, undefined],
  ])('%s', async (_name, declared, expected) => {
    const spy = jest
      .spyOn(idempotencyService, 'withIdempotency')
      .mockResolvedValue({ ok: true } as any);

    const mw = idempotencyMiddleware({ operation: 'test_op', leaseReclaim: declared });
    const req: any = { user: { id: 'u1' }, headers: { 'idempotency-key': 'abc' } };
    mw(req, {} as any, jest.fn());
    await req.runIdempotent(async () => ({ x: 1 }));

    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      'u1',
      'test_op',
      'abc',
      expect.any(Function),
      { leaseReclaim: expected }
    );
    spy.mockRestore();
  });
});
