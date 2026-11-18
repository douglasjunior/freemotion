export const GL_BACKENDS = ['angle', 'swangle', 'egl', 'swiftshader', 'vulkan'] as const;

export type GlBackend = (typeof GL_BACKENDS)[number];

export function isGlBackend(value: string): value is GlBackend {
  return (GL_BACKENDS as readonly string[]).includes(value);
}

/** Pure function returning Chromium CLI arguments for the specified WebGL backend. */
export function glArgs(backend: GlBackend): string[] {
  switch (backend) {
    case 'angle':
      return ['--use-gl=angle', '--use-angle=gl'];
    case 'swangle':
      return ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
    case 'egl':
      return ['--use-gl=egl'];
    case 'swiftshader':
      return ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'];
    case 'vulkan':
      return ['--use-angle=vulkan', '--use-vulkan=native', '--disable-vulkan-fallback-to-gl-for-testing'];
    default:
      throw new Error(`Unknown WebGL backend "${backend}". Supported: ${GL_BACKENDS.join(', ')}.`);
  }
}
