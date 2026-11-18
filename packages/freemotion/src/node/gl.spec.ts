import { describe, expect, it } from 'vitest';

import { GL_BACKENDS, glArgs, isGlBackend, type GlBackend } from './gl.js';


describe('glArgs', () => {
  it.each([
    ['angle', ['--use-gl=angle', '--use-angle=gl']],
    ['swangle', ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']],
    ['egl', ['--use-gl=egl']],
    ['swiftshader', ['--use-gl=swiftshader', '--enable-unsafe-swiftshader']],
    ['vulkan', ['--use-angle=vulkan', '--use-vulkan=native', '--disable-vulkan-fallback-to-gl-for-testing']],
  ] satisfies [GlBackend, string[]][])('returns arguments for %s', (backend, expected) => {
    expect(glArgs(backend)).toEqual(expected);
  });

  it('rejects an unsupported backend', () => {
    // @ts-expect-error testing invalid argument
    expect(() => glArgs('invalid')).toThrow('Unknown WebGL backend "invalid". Supported: angle, swangle, egl, swiftshader, vulkan.');
  });
});

describe('isGlBackend', () => {
  it('identifies valid backends', () => {
    for (const backend of GL_BACKENDS) {
      expect(isGlBackend(backend)).toBe(true);
    }
    expect(isGlBackend('invalid')).toBe(false);
  });
});
