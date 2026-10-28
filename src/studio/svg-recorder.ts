// Runs in the render page. After each frame is drawn it samples the stage's DOM (which nodes exist,
// their attributes and inline styles, the text) and, at the end, embeds the stylesheets and the
// resources they use and hands everything to svg-export.ts to build the animated SVG.
import {
  buildSvgDocument,
  pushSample,
  XHTML_NS,
  type ElementRecord,
  type NodeRecord,
  type TextRecord,
  type Track,
} from './svg-export.js';


export type SvgRecorderFinish = {
  readonly fps: number;
  readonly loop: boolean;
  readonly width: number;
  readonly height: number;
};

const URL_IN_CSS = /url\(\s*(["']?)([^"')]+)\1\s*\)/g;
const RESOURCE_ATTRIBUTES = new Set(['src', 'href', 'xlink:href', 'poster']);

const normalizeFamily = (name: string) => name.trim().replace(/^["']|["']$/g, '').trim().toLowerCase();

/** `U+0000-00FF, U+0131, U+02??` → `[[0, 255], [305, 305], [512, 767]]`. */
export function parseUnicodeRange(value: string): [number, number][] {
  const ranges: [number, number][] = [];
  for (const part of value.split(',')) {
    const match = /^\s*U\+([0-9A-F?]+)(?:-([0-9A-F]+))?\s*$/i.exec(part);
    if (!match) {
      continue;
    }
    const [, start, end] = match;
    if (start!.includes('?')) {
      ranges.push([parseInt(start!.replace(/\?/g, '0'), 16), parseInt(start!.replace(/\?/g, 'F'), 16)]);
    } else {
      ranges.push([parseInt(start!, 16), parseInt(end ?? start!, 16)]);
    }
  }
  return ranges;
}

export class SvgRecorder {
  private readonly records = new Map<number, NodeRecord>();
  private readonly ids = new WeakMap<Node, number>();
  private readonly families = new Set<string>();
  private readonly codePoints = new Set<number>();
  private readonly warnings: string[] = [];
  private readonly resources = new Map<string, Promise<string | null>>();
  private present = new Set<number>();
  private nextId = 1;
  private root: number | null = null;
  private frames = 0;

  /** Samples the stage as it is right now, as the next frame of the output. */
  record(stage: Element): void {
    const at = this.frames++;
    const now = new Set<number>();
    this.root = this.visitElement(stage, null, at, now).id;
    for (const id of this.present) {
      if (!now.has(id)) {
        pushSample(this.records.get(id)!.presence, at, false);
      }
    }
    this.present = now;
  }

  async finish({ fps, loop, width, height }: SvgRecorderFinish): Promise<{ svg: string; warnings: string[] }> {
    if (this.root === null) {
      throw new Error('No frame was recorded.');
    }
    const css = await this.collectCss();
    await this.inlineTrackResources();
    const svg = buildSvgDocument({ records: this.records, root: this.root, frames: this.frames, fps, loop, width, height, css });
    return { svg, warnings: this.warnings };
  }

  // --- Sampling ----------------------------------------------------------------------------------

  private visitElement(element: Element, parent: ElementRecord | null, at: number, now: Set<number>): ElementRecord {
    const record = this.elementRecord(element, parent);
    now.add(record.id);
    pushSample(record.presence, at, true);

    const seen = new Set<string>();
    for (const { name, value } of element.attributes) {
      if (name === 'style') {
        continue;
      }
      seen.add(name);
      pushSample(this.track(record.attributes, name), at, value);
    }
    if (element instanceof HTMLCanvasElement) {
      // A canvas has no markup; what it drew travels as an image.
      seen.add('src');
      pushSample(this.track(record.attributes, 'src'), at, element.toDataURL());
    }
    for (const [name, track] of record.attributes) {
      if (!seen.has(name)) {
        pushSample(track, at, null);
      }
    }

    const style = (element as HTMLElement | SVGElement).style as CSSStyleDeclaration | undefined;
    const declared = new Set<string>();
    pushSample(record.inlineStyle, at, style?.cssText ?? '');
    if (style) {
      for (let i = 0; i < style.length; i++) {
        const property = style.item(i);
        declared.add(property);
        pushSample(this.track(record.style, property), at, style.getPropertyValue(property));
      }
    }
    for (const [property, track] of record.style) {
      if (!declared.has(property)) {
        pushSample(track, at, null);
      }
    }

    const computed = getComputedStyle(element);
    pushSample(record.display, at, computed.display);

    let previous: number | null = null;
    let hasText = false;
    for (const child of element.childNodes) {
      let childRecord: NodeRecord | null = null;
      if (child instanceof Element) {
        childRecord = this.visitElement(child, record, at, now);
      } else if (child.nodeType === Node.TEXT_NODE) {
        childRecord = this.visitText(child as Text, record, at, now);
        hasText ||= (child as Text).data.trim() !== '';
      }
      if (childRecord) {
        this.place(record, childRecord.id, previous);
        previous = childRecord.id;
      }
    }
    if (hasText) {
      computed.fontFamily.split(',').forEach(family => this.families.add(normalizeFamily(family)));
    }
    return record;
  }

  private visitText(text: Text, parent: ElementRecord, at: number, now: Set<number>): TextRecord {
    let id = this.ids.get(text);
    let record = id === undefined ? undefined : (this.records.get(id) as TextRecord | undefined);
    if (!record || record.parent !== parent.id) {
      id = this.nextId++;
      record = { kind: 'text', id, parent: parent.id, presence: [], data: [] };
      this.ids.set(text, id);
      this.records.set(id, record);
    }
    now.add(record.id);
    pushSample(record.presence, at, true);
    pushSample(record.data, at, text.data);
    for (const char of text.data) {
      this.codePoints.add(char.codePointAt(0)!);
    }
    return record;
  }

  private elementRecord(element: Element, parent: ElementRecord | null): ElementRecord {
    const id = this.ids.get(element);
    const existing = id === undefined ? undefined : (this.records.get(id) as ElementRecord | undefined);
    // A node that moved to another parent starts a new life; the old record simply ends.
    if (existing && existing.parent === (parent?.id ?? null)) {
      return existing;
    }
    const canvas = element instanceof HTMLCanvasElement;
    const record: ElementRecord = {
      kind: 'element',
      id: this.nextId++,
      parent: parent?.id ?? null,
      namespace: element.namespaceURI ?? XHTML_NS,
      tag: canvas ? 'img' : element.localName,
      children: [],
      presence: [],
      attributes: new Map(),
      style: new Map(),
      inlineStyle: [],
      display: [],
    };
    this.ids.set(element, record.id);
    this.records.set(record.id, record);
    return record;
  }

  /** Keeps `child` right after `previous` in the merged child order of `parent`. */
  private place(parent: ElementRecord, child: number, previous: number | null) {
    if (parent.children.includes(child)) {
      return;
    }
    const index = previous === null ? -1 : parent.children.indexOf(previous);
    parent.children.splice(index + 1, 0, child);
  }

  private track<T>(map: Map<string, Track<T>>, key: string): Track<T> {
    let track = map.get(key);
    if (!track) {
      track = [];
      map.set(key, track);
    }
    return track;
  }

  // --- Resources ---------------------------------------------------------------------------------

  /** The resource as a data: URL, fetched once; `null` (and a warning) when it can't be read. */
  private resource(url: string, base: string): Promise<string | null> {
    let absolute: string;
    try {
      absolute = new URL(url, base).href;
    } catch {
      return Promise.resolve(null);
    }
    if (/^(data|blob|about):/.test(absolute) || url.startsWith('#')) {
      return Promise.resolve(null);
    }
    let pending = this.resources.get(absolute);
    if (!pending) {
      pending = fetch(absolute)
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          const blob = await response.blob();
          return await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          });
        })
        .catch((error: unknown) => {
          this.warnings.push(`Could not embed ${absolute} (${error instanceof Error ? error.message : String(error)}); the SVG links to it instead.`);
          return null;
        });
      this.resources.set(absolute, pending);
    }
    return pending;
  }

  /** Replaces every `url()` of a CSS text with a data: URL. */
  private async inlineCssUrls(css: string, base: string): Promise<string> {
    const urls = [...css.matchAll(URL_IN_CSS)].map(match => match[2]!);
    const replacements = new Map(await Promise.all(urls.map(async url => [url, await this.resource(url, base)] as const)));
    return css.replace(URL_IN_CSS, (whole, _quote, url: string) => {
      const data = replacements.get(url);
      return data ? `url("${data}")` : whole;
    });
  }

  private async inlineTrackResources(): Promise<void> {
    const base = document.baseURI;
    const jobs: Promise<void>[] = [];
    for (const record of this.records.values()) {
      if (record.kind !== 'element') {
        continue;
      }
      for (const [name, track] of record.attributes) {
        if (!RESOURCE_ATTRIBUTES.has(name)) {
          continue;
        }
        for (const sample of track) {
          if (sample.value !== null) {
            jobs.push(this.resource(sample.value, base).then((data) => {
              if (data) {
                (sample as { value: string | null }).value = data;
              }
            }));
          }
        }
      }
      for (const track of [...record.style.values(), record.inlineStyle]) {
        for (const sample of track) {
          if (sample.value !== null && sample.value.includes('url(')) {
            jobs.push(this.inlineCssUrls(sample.value, base).then((value) => {
              (sample as { value: string | null }).value = value;
            }));
          }
        }
      }
    }
    await Promise.all(jobs);
  }

  // --- Stylesheets -------------------------------------------------------------------------------

  private fontFaceIsUsed(rule: CSSFontFaceRule): boolean {
    const family = normalizeFamily(rule.style.getPropertyValue('font-family'));
    if (!this.families.has(family)) {
      return false;
    }
    const range = rule.style.getPropertyValue('unicode-range');
    if (!range) {
      return true;
    }
    const ranges = parseUnicodeRange(range);
    for (const codePoint of this.codePoints) {
      if (ranges.some(([start, end]) => codePoint >= start && codePoint <= end)) {
        return true;
      }
    }
    return false;
  }

  private async collectSheet(sheet: CSSStyleSheet, parts: string[]): Promise<void> {
    const base = sheet.href ?? document.baseURI;
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      // Cross-origin: take the text as served.
      const text = sheet.href ? await fetch(sheet.href).then(response => (response.ok ? response.text() : null)).catch(() => null) : null;
      if (text === null) {
        this.warnings.push(`Could not read the stylesheet ${sheet.href}; its rules are missing from the SVG.`);
        return;
      }
      parts.push(await this.inlineCssUrls(text, base));
      return;
    }
    for (const rule of rules) {
      if (rule instanceof CSSImportRule) {
        if (rule.styleSheet) {
          await this.collectSheet(rule.styleSheet, parts);
        }
      } else if (rule instanceof CSSFontFaceRule) {
        if (this.fontFaceIsUsed(rule)) {
          parts.push(await this.inlineCssUrls(rule.cssText, base));
        }
      } else {
        parts.push(await this.inlineCssUrls(rule.cssText, base));
      }
    }
  }

  private async collectCss(): Promise<string> {
    const parts: string[] = [];
    for (const sheet of [...document.styleSheets, ...document.adoptedStyleSheets]) {
      await this.collectSheet(sheet, parts);
    }
    return parts.join('\n');
  }
}
