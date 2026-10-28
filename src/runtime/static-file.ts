type ViteImportMeta = ImportMeta & { readonly env?: { readonly BASE_URL?: string } };

/**
 * URL of a file in the project's `public/` folder. Honours Vite's `base`, so it keeps working when
 * the composition is embedded in a site served from a sub-path.
 */
export function staticFile(path: string): string {
  const base = (import.meta as ViteImportMeta).env?.BASE_URL ?? '/';
  return `${base.endsWith('/') ? base : `${base}/`}${path.replace(/^\/+/, '')}`;
}
