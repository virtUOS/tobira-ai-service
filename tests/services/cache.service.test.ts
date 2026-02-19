// Mock the config module so the service can be instantiated without a .env file
jest.mock('../../src/config', () => ({
  config: {
    performance: { cacheTtlSeconds: 3600 },
    openai: { apiKey: 'test-key', defaultModel: 'gpt-4o', maxTranscriptLength: 100000 },
    database: { url: 'postgresql://test:test@localhost/test' },
    server: { port: 3001, env: 'test' },
    features: { enabled: true },
  },
}));

import { CacheService } from '../../src/services/cache.service';

describe('CacheService', () => {
  let cache: CacheService;

  beforeEach(() => {
    cache = new CacheService();
  });

  // ── Basic get/set ────────────────────────────────────────────────────────

  it('returns null for a key that was never set', async () => {
    expect(await cache.get('nonexistent')).toBeNull();
  });

  it('stores and retrieves a string value', async () => {
    await cache.set('k', 'hello', 60);
    expect(await cache.get('k')).toBe('hello');
  });

  it('stores and retrieves an object value', async () => {
    const obj = { summary: 'test', approved: false };
    await cache.set('obj-key', obj, 60);
    expect(await cache.get('obj-key')).toEqual(obj);
  });

  it('stores and retrieves a number value', async () => {
    await cache.set('num', 42, 60);
    expect(await cache.get<number>('num')).toBe(42);
  });

  // ── Invalidation / clear ─────────────────────────────────────────────────

  it('invalidate() removes the key', async () => {
    await cache.set('to-delete', 'value', 60);
    await cache.invalidate('to-delete');
    expect(await cache.get('to-delete')).toBeNull();
  });

  it('invalidate() on a non-existent key does not throw', async () => {
    await expect(cache.invalidate('ghost')).resolves.toBeUndefined();
  });

  it('clear() removes all keys', async () => {
    await cache.set('a', 1, 60);
    await cache.set('b', 2, 60);
    await cache.clear();
    expect(await cache.get('a')).toBeNull();
    expect(await cache.get('b')).toBeNull();
  });

  // ── has() ────────────────────────────────────────────────────────────────

  it('has() returns false for a missing key', async () => {
    expect(await cache.has('missing')).toBe(false);
  });

  it('has() returns true for an existing key', async () => {
    await cache.set('exists', true, 60);
    expect(await cache.has('exists')).toBe(true);
  });

  it('has() returns false after invalidation', async () => {
    await cache.set('gone', 'value', 60);
    await cache.invalidate('gone');
    expect(await cache.has('gone')).toBe(false);
  });

  // ── Statistics ───────────────────────────────────────────────────────────

  it('getStats() reports a hit after a successful get', async () => {
    await cache.set('hit-key', 'value', 60);
    await cache.get('hit-key');
    const stats = cache.getStats();
    expect(stats.hits).toBeGreaterThanOrEqual(1);
  });

  it('getStats() reports a miss for a missing key', async () => {
    await cache.get('miss-key');
    const stats = cache.getStats();
    expect(stats.misses).toBeGreaterThanOrEqual(1);
  });

  it('getStats().size reflects the number of cached entries', async () => {
    await cache.clear();
    await cache.set('x', 1, 60);
    await cache.set('y', 2, 60);
    expect(cache.getStats().size).toBe(2);
  });

  // ── TTL expiry ───────────────────────────────────────────────────────────

  describe('TTL behaviour', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('serves a value before the TTL has elapsed', async () => {
      await cache.set('ttl-live', 'alive', 60); // 60-second TTL
      jest.advanceTimersByTime(59 * 1000);
      expect(await cache.get('ttl-live')).toBe('alive');
    });

    it('returns null after the TTL has elapsed', async () => {
      await cache.set('ttl-dead', 'alive', 60);
      jest.advanceTimersByTime(61 * 1000);
      expect(await cache.get('ttl-dead')).toBeNull();
    });

    it('has() returns false after TTL expiry', async () => {
      await cache.set('ttl-has', 'value', 1);
      jest.advanceTimersByTime(2000);
      expect(await cache.has('ttl-has')).toBe(false);
    });
  });

  // ── Static key generators ────────────────────────────────────────────────

  describe('static key helpers', () => {
    it('summaryKey() produces a stable key', () => {
      expect(CacheService.summaryKey(123, 'en')).toBe('summary:123:en');
      expect(CacheService.summaryKey('456', 'de-de')).toBe('summary:456:de-de');
    });

    it('transcriptKey() produces a stable key', () => {
      expect(CacheService.transcriptKey(123, 'en')).toBe('transcript:123:en');
      expect(CacheService.transcriptKey('456', 'de-de')).toBe('transcript:456:de-de');
    });

    it('different key types do not collide', () => {
      expect(CacheService.summaryKey(1, 'en')).not.toBe(CacheService.transcriptKey(1, 'en'));
    });
  });
});
