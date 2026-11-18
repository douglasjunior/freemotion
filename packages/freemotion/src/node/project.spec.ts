import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveEntry } from './project.js';


describe('resolveEntry', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'freemotion-project-'));
    mkdirSync(join(root, 'src'));
  });

  it('prefers src/compositions.tsx', () => {
    writeFileSync(join(root, 'src/index.tsx'), '');
    writeFileSync(join(root, 'src/compositions.tsx'), '');
    expect(resolveEntry(root)).toBe(join(root, 'src/compositions.tsx'));
  });

  it('falls back to src/index', () => {
    writeFileSync(join(root, 'src/index.ts'), '');
    expect(resolveEntry(root)).toBe(join(root, 'src/index.ts'));
  });

  it('uses an explicit entry', () => {
    writeFileSync(join(root, 'videos.tsx'), '');
    expect(resolveEntry(root, 'videos.tsx')).toBe(join(root, 'videos.tsx'));
    expect(() => resolveEntry(root, 'missing.tsx')).toThrow(/not found/);
  });

  it('explains what to create when nothing is found', () => {
    expect(() => resolveEntry(root)).toThrow(/Create src\/compositions.tsx/);
  });
});
