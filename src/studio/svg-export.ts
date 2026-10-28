// Turns the frames a composition drew into one animated SVG. The stage's DOM goes inside a
// <foreignObject>; every value that changed between frames (inline styles, SVG attributes, which
// elements exist, what a text node says) is replayed by CSS @keyframes that step at the frame rate,
// so the file shows the same picture at the same instant as the video. No DOM APIs here: the
// recorder (svg-recorder.ts) feeds samples in, this module only builds strings.

export const XHTML_NS = 'http://www.w3.org/1999/xhtml';
export const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

export type Sample<T> = { readonly at: number; readonly value: T };
/** Run-length samples over frame indices: each entry holds from its index until the next entry. */
export type Track<T> = Sample<T>[];

/** Appends a sample unless the value is the one already in force. */
export function pushSample<T>(track: Track<T>, at: number, value: T): void {
  const last = track[track.length - 1];
  if (!last || last.value !== value) {
    track.push({ at, value });
  }
}

/** The value in force at a frame index; `undefined` before the first sample. */
export function sampleAt<T>(track: readonly Sample<T>[], at: number): T | undefined {
  let result: T | undefined;
  for (const sample of track) {
    if (sample.at > at) {
      break;
    }
    result = sample.value;
  }
  return result;
}

export type ElementRecord = {
  readonly kind: 'element';
  readonly id: number;
  readonly parent: number | null;
  readonly namespace: string;
  readonly tag: string;
  /** Child ids in document order, merged over every frame the element was seen in. */
  readonly children: number[];
  readonly presence: Track<boolean>;
  /** Attributes other than `style`; `null` once an attribute is removed. */
  readonly attributes: Map<string, Track<string | null>>;
  /** Longhand declarations of the inline style; `null` once a declaration is removed. */
  readonly style: Map<string, Track<string | null>>;
  /** The inline style as written (`cssText`), for the static part of the output. */
  readonly inlineStyle: Track<string>;
  /** Computed `display`, sampled while present. */
  readonly display: Track<string>;
};

export type TextRecord = {
  readonly kind: 'text';
  readonly id: number;
  readonly parent: number | null;
  readonly presence: Track<boolean>;
  readonly data: Track<string>;
};

export type NodeRecord = ElementRecord | TextRecord;

export type SvgDocumentOptions = {
  readonly records: ReadonlyMap<number, NodeRecord>;
  /** Id of the stage element. */
  readonly root: number;
  /** How many frames were recorded. */
  readonly frames: number;
  /** Frames per second of the output (already divided by `--every-nth-frame`). */
  readonly fps: number;
  readonly loop: boolean;
  readonly width: number;
  readonly height: number;
  /** Stylesheet text to embed, with its resources already inlined. */
  readonly css: string;
};

// --- SVG attributes that CSS can animate ---------------------------------------------------------

const PRESENTATION_ATTRIBUTES = new Set([
  'opacity', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-opacity', 'stroke-width',
  'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
  'color', 'visibility',
]);
const GEOMETRY_ATTRIBUTES = new Set(['x', 'y', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height']);
const GEOMETRY_ELEMENTS = new Set(['rect', 'circle', 'ellipse', 'image', 'svg', 'foreignObject', 'use']);
const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;

/** `rotate(45 10 10) translate(5)` (SVG attribute syntax) → the same transform in CSS syntax. */
export function svgTransformToCss(value: string): string | null {
  const functions: string[] = [];
  const pattern = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  const leftover = value.replace(pattern, (_, name: string, rawArgs: string) => {
    const args = rawArgs.trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (args.some(Number.isNaN)) {
      functions.push('\0');
      return '';
    }
    const [a = 0, b, c] = args;
    switch (name) {
      case 'translate':
        functions.push(`translate(${a}px, ${b ?? 0}px)`);
        break;
      case 'scale':
        functions.push(`scale(${a}, ${b ?? a})`);
        break;
      case 'rotate':
        functions.push(b === undefined
          ? `rotate(${a}deg)`
          : `translate(${b}px, ${c ?? 0}px) rotate(${a}deg) translate(${-b}px, ${-(c ?? 0)}px)`);
        break;
      case 'skewX':
      case 'skewY':
        functions.push(`${name}(${a}deg)`);
        break;
      case 'matrix':
        functions.push(args.length === 6 ? `matrix(${args.join(', ')})` : '\0');
        break;
      default:
        functions.push('\0');
    }
    return '';
  });
  if (leftover.trim() !== '' || functions.includes('\0')) {
    return null;
  }
  return functions.length === 0 ? 'none' : functions.join(' ');
}

/** The CSS declaration that reproduces an SVG attribute, or `null` when CSS can't express it. */
export function attributeAsCss(namespace: string, tag: string, name: string, value: string): { property: string; value: string } | null {
  if (namespace !== SVG_NS) {
    return null;
  }
  if (name === 'transform') {
    const converted = svgTransformToCss(value);
    return converted === null ? null : { property: 'transform', value: converted };
  }
  if (PRESENTATION_ATTRIBUTES.has(name)) {
    return { property: name, value };
  }
  if (GEOMETRY_ATTRIBUTES.has(name) && GEOMETRY_ELEMENTS.has(tag)) {
    const trimmed = value.trim();
    return { property: name, value: NUMBER.test(trimmed) && Number(trimmed) !== 0 ? `${trimmed}px` : trimmed };
  }
  return null;
}

// --- Serialization helpers -----------------------------------------------------------------------

// eslint-disable-next-line no-control-regex
const INVALID_XML = /[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g;
const XML_NAME = /^[A-Za-z_:][\w.:-]*$/;
const VOID_HTML = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

export function escapeText(value: string): string {
  return value.replace(INVALID_XML, '').replace(/[&<>]/g, char => (char === '&' ? '&amp;' : char === '<' ? '&lt;' : '&gt;'));
}

export function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;');
}

/** Percentage of the timeline where frame index `at` starts. */
export function keyframeOffset(at: number, frames: number): string {
  return `${Number(((at / frames) * 100).toFixed(6))}%`;
}

const isVarying = (track: readonly Sample<unknown>[]) => track.length > 1;

/** Value of a track at an index, falling back to its first value before the track starts. */
function trackValue<T>(track: readonly Sample<T>[], at: number): T | undefined {
  const first = track[0];
  return first && at < first.at ? first.value : sampleAt(track, at);
}

// --- The builder ---------------------------------------------------------------------------------

type Range = { readonly from: number; readonly to: number };

/**
 * Chromium only starts the animations of an element once every ancestor is displayed, so whatever
 * sits inside an element that appears at frame k would run k frames late. Every emitted element
 * therefore covers one contiguous run of frames, and everything inside it starts with a negative
 * delay of the run's first frame, which puts it back in step with the rest of the file.
 */
export function buildSvgDocument(options: SvgDocumentOptions): string {
  const { records, frames, fps, loop, width, height } = options;
  const keyframes: string[] = [];
  const seconds = (count: number) => `${Number((count / fps).toFixed(6))}s`;
  const animation = (name: string, revealAt: number) =>
    `animation:${name} ${seconds(frames)} step-end${revealAt > 0 ? ` -${seconds(revealAt)}` : ''} ${loop ? 'infinite' : '1 forwards'}`;

  const presentAt = (record: NodeRecord, at: number) => sampleAt(record.presence, at) === true;
  /** Present and not hidden by its own `display: none`. */
  const renderedAt = (record: ElementRecord, at: number) => presentAt(record, at) && trackValue(record.display, at) !== 'none';

  /** `@keyframes` holding every animated property at every index where any of them changes. */
  const defineKeyframes = (name: string, animated: ReadonlyMap<string, readonly Sample<string | null>[]>) => {
    const indices = new Set<number>([0]);
    for (const track of animated.values()) {
      for (const sample of track) {
        if (sample.at < frames) {
          indices.add(sample.at);
        }
      }
    }
    const declarations = (at: number) => [...animated]
      .map(([property, track]) => `${property}:${trackValue(track, at) ?? 'revert-layer'}`)
      .join(';');
    // A keyframe that repeats the previous one changes nothing: skip it.
    const body: string[] = [];
    let previous: string | null = null;
    for (const at of [...indices].sort((a, b) => a - b)) {
      const current = declarations(at);
      if (current !== previous) {
        body.push(`${keyframeOffset(at, frames)}{${current}}`);
        previous = current;
      }
    }
    body.push(`100%{${declarations(frames - 1)}}`);
    keyframes.push(`@keyframes ${name}{${body.join('')}}`);
  };

  /** A `display` track that hides the node outside `range`; `null` when the enclosing element already does. */
  const displayTrack = (range: Range, parentRange: Range, shown: (at: number) => string): Track<string> | null => {
    if (range.from === parentRange.from && range.to === parentRange.to) {
      return null;
    }
    const track: Track<string> = [];
    for (let at = 0; at < frames; at++) {
      pushSample(track, at, at >= range.from && at <= range.to ? shown(at) : 'none');
    }
    return track;
  };

  /** Splits the frames where `visible` holds into runs where `signature` doesn't change. */
  const runsOf = (visible: (at: number) => boolean, signature: (at: number) => string): Range[] => {
    const runs: Range[] = [];
    let current: { from: number; to: number; key: string } | null = null;
    for (let at = 0; at < frames; at++) {
      if (!visible(at)) {
        current = null;
        continue;
      }
      const key = signature(at);
      if (current && current.key === key) {
        current.to = at;
      } else {
        current = { from: at, to: at, key };
        runs.push(current);
      }
    }
    return runs;
  };

  const emitNode = (id: number, parentNamespace: string, parentRange: Range): string => {
    const record = records.get(id);
    if (!record) {
      return '';
    }
    return record.kind === 'text' ? emitText(record, parentNamespace, parentRange) : emitElement(record, parentNamespace, parentRange);
  };

  const emitText = (record: TextRecord, parentNamespace: string, parentRange: Range): string => {
    const runs = runsOf(at => presentAt(record, at), at => trackValue(record.data, at) ?? '');
    if (runs.length === 1 && runs[0]!.from === parentRange.from && runs[0]!.to === parentRange.to) {
      return escapeText(trackValue(record.data, parentRange.from) ?? '');
    }
    // The text changes or comes and goes: one wrapper per run, shown only during it.
    const svgParent = parentNamespace === SVG_NS;
    const tag = svgParent ? 'tspan' : 'span';
    return runs.map((run) => {
      const name = `fm${record.id}-${run.from}`;
      defineKeyframes(name, new Map([['display', displayTrack(run, parentRange, () => (svgParent ? 'inline' : 'contents'))!]]));
      const text = escapeText(trackValue(record.data, run.from) ?? '');
      return `<${tag} style="${escapeAttribute(animation(name, parentRange.from))}">${text}</${tag}>`;
    }).join('');
  };

  const emitElement = (record: ElementRecord, parentNamespace: string, parentRange: Range): string => {
    const { namespace, tag } = record;
    if (tag === 'script') {
      return '';
    }
    // One copy per run of frames where the element is rendered and the attributes CSS can't
    // animate keep their values.
    const variants = [...record.attributes].filter(([name, track]) =>
      isVarying(track) && attributeAsCss(namespace, tag, name, trackValue(track, 0) ?? '') === null);
    const runs = runsOf(
      at => renderedAt(record, at),
      at => variants.map(([, track]) => trackValue(track, at) ?? '\0').join('\u0001'),
    );
    return runs.map(run => emitCopy(record, parentNamespace, parentRange, run, runs.length === 1 ? `fm${record.id}` : `fm${record.id}-${run.from}`)).join('');
  };

  const emitCopy = (record: ElementRecord, parentNamespace: string, parentRange: Range, range: Range, name: string): string => {
    const { namespace, tag } = record;
    const animated = new Map<string, readonly Sample<string | null>[]>();
    const attributes: string[] = [];
    const declarations: string[] = [];

    for (const [attribute, track] of record.attributes) {
      const value = trackValue(track, range.from);
      if (value !== null && value !== undefined && XML_NAME.test(attribute) && !/^on/i.test(attribute)) {
        attributes.push(` ${attribute}="${escapeAttribute(value)}"`);
      }
      if (isVarying(track)) {
        const css = attributeAsCss(namespace, tag, attribute, value ?? '');
        if (css) {
          animated.set(css.property, track.map(sample => ({
            at: sample.at,
            value: sample.value === null ? null : (attributeAsCss(namespace, tag, attribute, sample.value)?.value ?? null),
          })));
        }
      }
    }
    const inlineStyle = trackValue(record.inlineStyle, range.from)?.trim().replace(/;$/, '');
    if (inlineStyle) {
      declarations.push(inlineStyle);
    }
    for (const [property, track] of record.style) {
      if (isVarying(track)) {
        animated.set(property, track);
      }
    }
    const display = displayTrack(range, parentRange, at => trackValue(record.display, at) ?? 'block');
    if (display) {
      animated.set('display', display);
    }
    if (animated.size > 0) {
      defineKeyframes(name, animated);
      declarations.push(animation(name, parentRange.from));
    }
    if (declarations.length > 0) {
      attributes.push(` style="${escapeAttribute(declarations.join(';'))}"`);
    }

    const xmlns = namespace === parentNamespace ? '' : ` xmlns="${escapeAttribute(namespace)}"`;
    const children = record.children.map(child => emitNode(child, namespace, range)).join('');
    const open = `<${tag}${xmlns}${attributes.join('')}`;
    if (children === '' && (namespace !== XHTML_NS || VOID_HTML.has(tag))) {
      return `${open}/>`;
    }
    return `${open}>${children}</${tag}>`;
  };

  const content = emitNode(options.root, SVG_NS, { from: 0, to: frames - 1 });
  const style = `${options.css}\n${keyframes.join('\n')}`;
  return [
    `<svg xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<style>${escapeText(style)}</style>`,
    `<foreignObject x="0" y="0" width="${width}" height="${height}">${content}</foreignObject>`,
    '</svg>',
    '',
  ].join('\n');
}
