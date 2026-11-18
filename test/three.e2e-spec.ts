import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

import { CLI, REPO, run } from './helpers.js';


const fixture = join(REPO, 'test/fixtures/three');

beforeAll(() => {
  const vertices = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
  ];
  const faces = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 3, 0, 4, 3, 4, 7];
  const positions = new Float32Array(faces.flatMap(index => vertices[index]!));
  const binary = Buffer.from(positions.buffer);
  const gltf = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }], materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1], metallicFactor: 0 }, doubleSided: true }], buffers: [{ byteLength: binary.length }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: binary.length }], accessors: [{ bufferView: 0, componentType: 5126, count: 36, type: 'VEC3', min: [-1, -1, -1], max: [1, 1, 1] }] };
  const raw = Buffer.from(JSON.stringify(gltf));
  const json = Buffer.alloc(Math.ceil(raw.length / 4) * 4, 0x20);
  raw.copy(json);
  const header = Buffer.alloc(12);
  header.write('glTF');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + binary.length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(json.length);
  jsonHeader.write('JSON', 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binary.length);
  binHeader.write('BIN\0', 4);
  mkdirSync(join(fixture, 'public'), { recursive: true });
  writeFileSync(join(fixture, 'public/model.glb'), Buffer.concat([header, jsonHeader, json, binHeader, binary]));
});
afterAll(() => {
  rmSync(join(fixture, 'public/model.glb'), { force: true });
});

it('renders the same frame with swangle', async () => {
  const out = mkdtempSync(join(REPO, 'test/.tmp-three-'));
  try {
    const first = join(out, 'first.png');
    const second = join(out, 'second.png');
    for (const output of [first, second]) {
      const result = await run(['render', 'Cube', '--frame', '7', '--gl', 'swangle', '-o', output], fixture);
      expect(result.code, result.stderr).toBe(0);
    }
    expect(readFileSync(first)).toEqual(readFileSync(second));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

it('renders consistently with different concurrency', async () => {
  const { psnr, referenceFrame } = await import('./helpers.js');
  const out = mkdtempSync(join(REPO, 'test/.tmp-three-'));
  try {
    const outputs = [join(out, 'one.mp4'), join(out, 'four.mp4')];
    for (const [index, output] of outputs.entries()) {
      const result = await run(['render', 'Cube', '--concurrency', index ? '4' : '1', '--gl', 'swangle', '-o', output], fixture);
      expect(result.code, result.stderr).toBe(0);
    }
    expect(psnr(outputs[0]!, outputs[1]!)).toBeGreaterThanOrEqual(50);
    const still = join(out, 'still.png');
    const result = await run(['render', 'Cube', '--frame', '7', '--gl', 'swangle', '-o', still], fixture);
    expect(result.code, result.stderr).toBe(0);
    for (const output of outputs) {
      expect(psnr(still, referenceFrame(output, 7 / 30, join(out, 'frame.png')))).toBeGreaterThanOrEqual(35);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

it('waits for suspended content and reports scene errors', async () => {
  const { centerPixel } = await import('./helpers.js');
  const out = mkdtempSync(join(REPO, 'test/.tmp-three-'));
  try {
    const output = join(out, 'model.png');
    const model = await run(['render', 'Model', '--frame', '0', '--gl', 'swangle', '-o', output], fixture);
    expect(model.code, model.stderr).toBe(0);
    const [red, green, blue] = centerPixel(output);
    expect(red).toBeGreaterThan(green + blue + 50);
    const error = await run(['render', 'ErrorScene', '--frame', '0', '--gl', 'swangle', '-o', output], fixture);
    expect(error.code).not.toBe(0);
    expect(error.stderr).toContain('Three fixture error');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});


it('keeps the native canvas size inside the scaled studio player', async () => {
  const child = spawn(process.execPath, [CLI, 'studio', '--port', '0', '--no-open'], { cwd: fixture });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let output = '';
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        const match = /Studio ready at (http:\/\/\S+)/.exec(output);
        if (match) resolve(match[1]!);
      });
      child.on('error', reject);
      child.on('exit', code => reject(new Error(`Studio exited: ${code}`)));
    });
    browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 700, height: 600 } });
    await page.goto(`${url}?composition=Cube`);
    const canvas = page.locator('canvas');
    await canvas.waitFor();
    const dimensions = await canvas.evaluate((element) => {
      const el = element as HTMLCanvasElement;
      return { width: el.width, height: el.height, context: Boolean(el.getContext('webgl2')), bounds: el.getBoundingClientRect().toJSON() };
    });
    expect(dimensions.width).toBe(128);
    expect(dimensions.height).toBe(128);
    expect(dimensions.context).toBe(true);
    expect(dimensions.bounds.width / dimensions.bounds.height).toBeCloseTo(1);
  } finally {
    await browser?.close();
    child.kill();
  }
});
