import { pendingRenderHolds, resetRenderHolds, waitForRenderHolds } from './delay-render.js';
import { loadFont, resetFontCache } from './font.js';


type MockFontFaceInstance = {
  family: string;
  source: string;
  descriptors: FontFaceDescriptors;
  load: () => Promise<void>;
};

describe('loadFont', () => {
  beforeEach(() => {
    resetRenderHolds();
    resetFontCache();
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).document;
    delete (globalThis as Record<string, unknown>).FontFace;
    resetRenderHolds();
    resetFontCache();
  });

  it('resolves immediately when document is not defined', async () => {
    await expect(loadFont({ family: 'Inter', url: '/inter.woff2' })).resolves.toBeUndefined();
    expect(pendingRenderHolds()).toEqual([]);
  });

  it('resolves immediately when document.fonts is not defined', async () => {
    (globalThis as Record<string, unknown>).document = {};
    await expect(loadFont({ family: 'Inter', url: '/inter.woff2' })).resolves.toBeUndefined();
    expect(pendingRenderHolds()).toEqual([]);
  });

  it('creates FontFace, adds to document.fonts, takes a render hold and releases it on success', async () => {
    const addedFaces: MockFontFaceInstance[] = [];
    let finishLoad!: () => void;
    const loadPromise = new Promise<void>((resolve) => {
      finishLoad = resolve;
    });

    class MockFontFace implements MockFontFaceInstance {
      family: string;
      source: string;
      descriptors: FontFaceDescriptors;
      constructor(family: string, source: string, descriptors: FontFaceDescriptors = {}) {
        this.family = family;
        this.source = source;
        this.descriptors = descriptors;
      }

      load() {
        return loadPromise;
      }
    }

    (globalThis as Record<string, unknown>).FontFace = MockFontFace;
    (globalThis as Record<string, unknown>).document = {
      fonts: {
        add: vi.fn((face: MockFontFaceInstance) => {
          addedFaces.push(face);
        }),
      },
    };

    const promise = loadFont({
      family: 'Inter',
      url: '/fonts/inter.woff2',
      weight: 700,
      style: 'italic',
      display: 'swap',
    });

    expect(addedFaces).toHaveLength(1);
    expect(addedFaces[0]!.family).toBe('Inter');
    expect(addedFaces[0]!.source).toBe('url(/fonts/inter.woff2)');
    expect(addedFaces[0]!.descriptors).toEqual({
      weight: '700',
      style: 'italic',
      display: 'swap',
    });

    expect(pendingRenderHolds()).toEqual(['Loading font "Inter" from "/fonts/inter.woff2"']);

    finishLoad();
    await expect(promise).resolves.toBeUndefined();
    expect(pendingRenderHolds()).toEqual([]);
  });

  it('deduplicates calls with the same parameters and reuses the promise', async () => {
    let finishLoad!: () => void;
    const loadPromise = new Promise<void>((resolve) => {
      finishLoad = resolve;
    });

    let constructorCallCount = 0;
    class MockFontFace implements MockFontFaceInstance {
      family: string;
      source: string;
      descriptors: FontFaceDescriptors;
      constructor(family: string, source: string, descriptors: FontFaceDescriptors = {}) {
        constructorCallCount++;
        this.family = family;
        this.source = source;
        this.descriptors = descriptors;
      }

      load() {
        return loadPromise;
      }
    }

    const addMock = vi.fn();
    (globalThis as Record<string, unknown>).FontFace = MockFontFace;
    (globalThis as Record<string, unknown>).document = {
      fonts: { add: addMock },
    };

    const p1 = loadFont({ family: 'Inter', url: '/inter.woff2', weight: '400' });
    const p2 = loadFont({ family: 'Inter', url: '/inter.woff2', weight: '400' });

    expect(p1).toBe(p2);
    expect(constructorCallCount).toBe(1);
    expect(addMock).toHaveBeenCalledTimes(1);
    expect(pendingRenderHolds()).toHaveLength(1);

    finishLoad();
    await Promise.all([p1, p2]);
    expect(pendingRenderHolds()).toEqual([]);
  });

  it('cancels the render, rejects, and leaves no pending hold on load failure', async () => {
    class MockFontFace implements MockFontFaceInstance {
      family: string;
      source: string;
      descriptors: FontFaceDescriptors;
      constructor(family: string, source: string, descriptors: FontFaceDescriptors = {}) {
        this.family = family;
        this.source = source;
        this.descriptors = descriptors;
      }

      load() {
        return Promise.reject(new Error('404 Not Found'));
      }
    }

    (globalThis as Record<string, unknown>).FontFace = MockFontFace;
    (globalThis as Record<string, unknown>).document = {
      fonts: { add: vi.fn() },
    };

    const promise = loadFont({ family: 'BrokenFont', url: '/missing.woff2' });

    await expect(promise).rejects.toThrow('Failed to load font "BrokenFont" from "/missing.woff2": 404 Not Found');
    await expect(waitForRenderHolds()).rejects.toThrow('Failed to load font "BrokenFont" from "/missing.woff2": 404 Not Found');
    expect(pendingRenderHolds()).toEqual([]);
  });
});
