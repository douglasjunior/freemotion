import { ByteLruCache } from './lru-cache.js';


describe('ByteLruCache', () => {
  it('stores and retrieves items', () => {
    const cache = new ByteLruCache<string>(100);
    cache.set('a', 'alpha', 20);
    cache.set('b', 'beta', 30);

    expect(cache.get('a')).toBe('alpha');
    expect(cache.get('b')).toBe('beta');
    expect(cache.bytes).toBe(50);
    expect(cache.size).toBe(2);
  });

  it('evicts least recently used items when byte limit is exceeded', () => {
    const cache = new ByteLruCache<string>(50);
    cache.set('a', 'alpha', 20);
    cache.set('b', 'beta', 20);
    // bytes = 40

    // Adding 'c' (20 bytes) exceeds limit of 50 -> must evict 'a'
    cache.set('c', 'gamma', 20);
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
    expect(cache.has('c')).toBe(true);
    expect(cache.bytes).toBe(40);
  });

  it('updates access order on get', () => {
    const cache = new ByteLruCache<string>(50);
    cache.set('a', 'alpha', 20);
    cache.set('b', 'beta', 20);

    // Access 'a' so 'b' becomes the oldest
    expect(cache.get('a')).toBe('alpha');

    // Adding 'c' (20 bytes) should now evict 'b' instead of 'a'
    cache.set('c', 'gamma', 20);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(true);
  });

  it('properly updates bytes when replacing an existing key', () => {
    const cache = new ByteLruCache<string>(100);
    cache.set('a', 'small', 20);
    expect(cache.bytes).toBe(20);

    cache.set('a', 'larger', 50);
    expect(cache.bytes).toBe(50);
    expect(cache.size).toBe(1);
    expect(cache.get('a')).toBe('larger');
  });

  it('does not store item larger than maxBytes', () => {
    const cache = new ByteLruCache<string>(50);
    cache.set('huge', 'huge-value', 60);

    expect(cache.has('huge')).toBe(false);
    expect(cache.size).toBe(0);
    expect(cache.bytes).toBe(0);
  });

  it('supports delete and clear', () => {
    const cache = new ByteLruCache<string>(100);
    cache.set('a', 'alpha', 30);
    cache.set('b', 'beta', 40);

    expect(cache.delete('a')).toBe(true);
    expect(cache.has('a')).toBe(false);
    expect(cache.bytes).toBe(40);

    cache.clear();
    expect(cache.bytes).toBe(0);
    expect(cache.size).toBe(0);
  });
});
