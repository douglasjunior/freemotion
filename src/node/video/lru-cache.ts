type Entry<V> = {
  value: V;
  size: number;
};

/**
 * In-memory Least-Recently-Used (LRU) cache bounded by total byte size.
 */
export class ByteLruCache<V> {
  private readonly map = new Map<string, Entry<V>>();
  private currentBytes = 0;

  constructor(readonly maxBytes: number) {}

  get(key: string): V | undefined {
    const entry = this.map.get(key);
    if (!entry) {
      return undefined;
    }
    // Refresh access order (delete and re-insert to place at end)
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V, size: number): void {
    if (this.map.has(key)) {
      this.delete(key);
    }

    if (size > this.maxBytes) {
      return;
    }

    while (this.currentBytes + size > this.maxBytes && this.map.size > 0) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.delete(oldestKey);
      }
    }

    this.map.set(key, { value, size });
    this.currentBytes += size;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  delete(key: string): boolean {
    const entry = this.map.get(key);
    if (!entry) {
      return false;
    }
    this.currentBytes -= entry.size;
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
    this.currentBytes = 0;
  }

  get size(): number {
    return this.map.size;
  }

  get bytes(): number {
    return this.currentBytes;
  }
}
