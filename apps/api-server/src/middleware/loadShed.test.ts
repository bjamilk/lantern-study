import v8 from 'v8';
import { isUnderMemoryPressure } from './loadShed';

describe('isUnderMemoryPressure', () => {
  const originalEnv = process.env.LOAD_SHED_HEAP_RATIO;
  const originalRss = process.env.LOAD_SHED_RSS_BYTES;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.LOAD_SHED_HEAP_RATIO;
    else process.env.LOAD_SHED_HEAP_RATIO = originalEnv;
    if (originalRss === undefined) delete process.env.LOAD_SHED_RSS_BYTES;
    else process.env.LOAD_SHED_RSS_BYTES = originalRss;
    jest.restoreAllMocks();
  });

  it('does not treat a high heapUsed/heapTotal as pressure when limit has headroom', () => {
    // Typical cold Node: heapTotal small, used/total high, but far under heap_size_limit
    jest.spyOn(v8, 'getHeapStatistics').mockReturnValue({
      total_heap_size: 20 * 1024 * 1024,
      total_heap_size_executable: 0,
      total_physical_size: 20 * 1024 * 1024,
      total_available_size: 1.5 * 1024 * 1024 * 1024,
      used_heap_size: 18 * 1024 * 1024,
      heap_size_limit: 2 * 1024 * 1024 * 1024,
      malloced_memory: 0,
      peak_malloced_memory: 0,
      does_zap_garbage: 0,
      number_of_native_contexts: 1,
      number_of_detached_contexts: 0,
    } as v8.HeapInfo);

    jest.spyOn(process, 'memoryUsage').mockReturnValue({
      rss: 80 * 1024 * 1024,
      heapTotal: 20 * 1024 * 1024,
      heapUsed: 18 * 1024 * 1024,
      external: 0,
      arrayBuffers: 0,
    });

    process.env.LOAD_SHED_HEAP_RATIO = '0.90';
    process.env.LOAD_SHED_RSS_BYTES = String(1.5 * 1024 * 1024 * 1024);
    expect(isUnderMemoryPressure()).toBe(false);
  });

  it('sheds when used heap approaches the V8 limit', () => {
    jest.spyOn(v8, 'getHeapStatistics').mockReturnValue({
      total_heap_size: 1.8 * 1024 * 1024 * 1024,
      total_heap_size_executable: 0,
      total_physical_size: 1.8 * 1024 * 1024 * 1024,
      total_available_size: 50 * 1024 * 1024,
      used_heap_size: 1.85 * 1024 * 1024 * 1024,
      heap_size_limit: 2 * 1024 * 1024 * 1024,
      malloced_memory: 0,
      peak_malloced_memory: 0,
      does_zap_garbage: 0,
      number_of_native_contexts: 1,
      number_of_detached_contexts: 0,
    } as v8.HeapInfo);

    jest.spyOn(process, 'memoryUsage').mockReturnValue({
      rss: 100 * 1024 * 1024,
      heapTotal: 1.8 * 1024 * 1024 * 1024,
      heapUsed: 1.85 * 1024 * 1024 * 1024,
      external: 0,
      arrayBuffers: 0,
    });

    process.env.LOAD_SHED_HEAP_RATIO = '0.90';
    expect(isUnderMemoryPressure()).toBe(true);
  });
});
