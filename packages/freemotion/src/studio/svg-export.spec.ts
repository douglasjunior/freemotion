import {
  attributeAsCss,
  buildSvgDocument,
  escapeAttribute,
  keyframeOffset,
  pushSample,
  sampleAt,
  SVG_NS,
  svgTransformToCss,
  XHTML_NS,
  type ElementRecord,
  type NodeRecord,
  type TextRecord,
  type Track,
} from './svg-export.js';
import { parseUnicodeRange } from './svg-recorder.js';


const track = <T>(...samples: [number, T][]): Track<T> => samples.map(([at, value]) => ({ at, value }));

const element = (id: number, parent: number | null, partial: Partial<ElementRecord> = {}): ElementRecord => ({
  kind: 'element',
  id,
  parent,
  namespace: XHTML_NS,
  tag: 'div',
  children: [],
  presence: track([0, true]),
  attributes: new Map(),
  style: new Map(),
  inlineStyle: [],
  display: track([0, 'block']),
  ...partial,
});

const text = (id: number, parent: number, data: Track<string>, presence = track([0, true])): TextRecord => ({ kind: 'text', id, parent, presence, data });

const build = (nodes: NodeRecord[], options: { frames?: number; loop?: boolean } = {}) => buildSvgDocument({
  records: new Map(nodes.map(node => [node.id, node])),
  root: 1,
  frames: options.frames ?? 4,
  fps: 2,
  loop: options.loop ?? true,
  width: 10,
  height: 10,
  css: '.a{color:red}',
});

describe('tracks', () => {
  it('only records changes', () => {
    const values: Track<string> = [];
    pushSample(values, 0, 'a');
    pushSample(values, 1, 'a');
    pushSample(values, 2, 'b');
    pushSample(values, 3, 'b');
    expect(values).toEqual(track([0, 'a'], [2, 'b']));
    expect(sampleAt(values, 1)).toBe('a');
    expect(sampleAt(values, 3)).toBe('b');
  });

  it('is undefined before the first sample', () => {
    expect(sampleAt(track([2, 'x']), 1)).toBeUndefined();
  });
});

describe('svgTransformToCss', () => {
  it('adds the units CSS needs', () => {
    expect(svgTransformToCss('rotate(45)')).toBe('rotate(45deg)');
    expect(svgTransformToCss('translate(10, 20) scale(2)')).toBe('translate(10px, 20px) scale(2, 2)');
    expect(svgTransformToCss('translate(10)skewX(5)')).toBe('translate(10px, 0px) skewX(5deg)');
    expect(svgTransformToCss('matrix(1 0 0 1 5 5)')).toBe('matrix(1, 0, 0, 1, 5, 5)');
  });

  it('turns a rotation center into translates', () => {
    expect(svgTransformToCss('rotate(90 32 32)')).toBe('translate(32px, 32px) rotate(90deg) translate(-32px, -32px)');
  });

  it('maps an empty transform to none and gives up on what it does not know', () => {
    expect(svgTransformToCss('')).toBe('none');
    expect(svgTransformToCss('perspective(10)')).toBeNull();
    expect(svgTransformToCss('rotate(x)')).toBeNull();
    expect(svgTransformToCss('rotate(1) junk')).toBeNull();
  });
});

describe('attributeAsCss', () => {
  it('maps presentation and geometry attributes of SVG elements', () => {
    expect(attributeAsCss(SVG_NS, 'circle', 'fill', '#f00')).toEqual({ property: 'fill', value: '#f00' });
    expect(attributeAsCss(SVG_NS, 'circle', 'r', '12')).toEqual({ property: 'r', value: '12px' });
    expect(attributeAsCss(SVG_NS, 'rect', 'width', '50%')).toEqual({ property: 'width', value: '50%' });
    expect(attributeAsCss(SVG_NS, 'rect', 'x', '0')).toEqual({ property: 'x', value: '0' });
    expect(attributeAsCss(SVG_NS, 'g', 'transform', 'scale(2)')).toEqual({ property: 'transform', value: 'scale(2, 2)' });
  });

  it('leaves the rest to element copies', () => {
    expect(attributeAsCss(SVG_NS, 'path', 'd', 'M0 0')).toBeNull();
    expect(attributeAsCss(SVG_NS, 'line', 'x', '1')).toBeNull();
    expect(attributeAsCss(XHTML_NS, 'img', 'width', '1')).toBeNull();
  });
});

describe('keyframeOffset', () => {
  it('is the start of the frame, as a percentage', () => {
    expect(keyframeOffset(0, 3)).toBe('0%');
    expect(keyframeOffset(1, 3)).toBe('33.333333%');
    expect(keyframeOffset(3, 4)).toBe('75%');
  });
});

describe('escaping', () => {
  it('keeps the file well-formed XML', () => {
    expect(escapeAttribute('a "b" <c> & d\u0000')).toBe('a &quot;b&quot; &lt;c&gt; &amp; d');
  });
});

describe('buildSvgDocument', () => {
  it('wraps the stage in a foreignObject with the stylesheet', () => {
    const root = element(1, null, { attributes: new Map([['data-freemotion-stage', track([0, ''])]]), inlineStyle: track([0, 'width: 10px;']) });
    const svg = build([root]);
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('width="10" height="10" viewBox="0 0 10 10"');
    expect(svg).toContain('<style>.a{color:red}\n</style>');
    expect(svg).toContain('<foreignObject x="0" y="0" width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml" data-freemotion-stage="" style="width: 10px"></div></foreignObject>');
    expect(svg).not.toContain('@keyframes');
  });

  it('replays inline styles that change, stepping at the frame rate', () => {
    const child = element(2, 1, {
      style: new Map([['opacity', track([0, '0'], [1, '0.5'], [3, '1'])], ['color', track([0, 'red'])]]),
      inlineStyle: track([0, 'opacity: 0; color: red;']),
    });
    const svg = build([element(1, null, { children: [2] }), child]);
    expect(svg).toContain('@keyframes fm2{0%{opacity:0}25%{opacity:0.5}75%{opacity:1}100%{opacity:1}}');
    expect(svg).toContain('<div style="opacity: 0; color: red;animation:fm2 2s step-end infinite"></div>');
  });

  it('plays once with loop off', () => {
    const child = element(2, 1, { style: new Map([['opacity', track([0, '0'], [1, '1'])]]) });
    expect(build([element(1, null, { children: [2] }), child], { loop: false })).toContain('animation:fm2 2s step-end 1 forwards');
  });

  it('reverts a declaration that was removed', () => {
    const child = element(2, 1, { style: new Map([['opacity', track([0, '0'], [2, null])]]) });
    expect(build([element(1, null, { children: [2] }), child])).toContain('@keyframes fm2{0%{opacity:0}50%{opacity:revert-layer}100%{opacity:revert-layer}}');
  });

  it('hides an element while it is unmounted, with its own display value', () => {
    const late = element(2, 1, { presence: track([1, true], [3, false]), display: track([1, 'flex']) });
    const svg = build([element(1, null, { children: [2] }), late]);
    expect(svg).toContain('@keyframes fm2{0%{display:none}25%{display:flex}75%{display:none}100%{display:none}}');
  });

  it('copies an element once per run of frames it is mounted in', () => {
    const blink = element(2, 1, { presence: track([0, true], [1, false], [2, true], [3, false]) });
    const svg = build([element(1, null, { children: [2] }), blink]);
    expect(svg).toContain('<div style="animation:fm2-0 2s step-end infinite"></div><div style="animation:fm2-2 2s step-end infinite"></div>');
    expect(svg).toContain('@keyframes fm2-0{0%{display:block}25%{display:none}100%{display:none}}');
    expect(svg).toContain('@keyframes fm2-2{0%{display:none}50%{display:block}75%{display:none}100%{display:none}}');
  });

  it('starts what is inside a late element with a negative delay, so it stays in step', () => {
    const late = element(2, 1, { presence: track([2, true]), children: [3, 4] });
    const child = element(3, 2, { presence: track([2, true]), style: new Map([['opacity', track([2, '0'], [3, '1'])]]) });
    const svg = build([element(1, null, { children: [2] }), late, child, text(4, 2, track([2, 'a'], [3, 'b']), track([2, true]))]);
    expect(svg).toContain('<div style="animation:fm2 2s step-end infinite"><div style="animation:fm3 2s step-end -1s infinite"></div>');
    expect(svg).toContain('<span style="animation:fm4-2 2s step-end -1s infinite">a</span>');
    // The parent already hides it before frame 2: no display of its own.
    expect(svg).toContain('@keyframes fm3{0%{opacity:0}75%{opacity:1}100%{opacity:1}}');
    expect(svg).toContain('@keyframes fm4-2{0%{display:none}50%{display:contents}75%{display:none}100%{display:none}}');
  });

  it('treats display: none of its own like being unmounted', () => {
    const hidden = element(2, 1, { display: track([0, 'none'], [1, 'block']), children: [3] });
    const child = element(3, 2, { style: new Map([['opacity', track([0, '0'], [2, '1'])]]) });
    const svg = build([element(1, null, { children: [2] }), hidden, child]);
    expect(svg).toContain('@keyframes fm2{0%{display:none}25%{display:block}100%{display:block}}');
    expect(svg).toContain('animation:fm3 2s step-end -0.5s infinite');
  });

  it('animates SVG attributes through their CSS properties', () => {
    const circle = element(2, 1, {
      namespace: SVG_NS,
      tag: 'circle',
      attributes: new Map([['r', track([0, '1'], [1, '2'])], ['cx', track([0, '5'])], ['transform', track([0, 'rotate(0)'], [2, 'rotate(90)'])]]),
      display: track([0, 'inline']),
    });
    const svg = build([element(1, null, { children: [2] }), circle]);
    expect(svg).toContain('<circle xmlns="http://www.w3.org/2000/svg" r="1" cx="5" transform="rotate(0)" style="animation:fm2 2s step-end infinite"/>');
    expect(svg).toContain('@keyframes fm2{0%{r:1px;transform:rotate(0deg)}25%{r:2px;transform:rotate(0deg)}50%{r:2px;transform:rotate(90deg)}100%{r:2px;transform:rotate(90deg)}}');
  });

  it('copies an element once per value of an attribute CSS cannot animate', () => {
    const path = element(2, 1, {
      namespace: SVG_NS,
      tag: 'path',
      attributes: new Map([['d', track([0, 'M0 0'], [2, 'M1 1'])]]),
      display: track([0, 'inline']),
    });
    const svg = build([element(1, null, { children: [2] }), path]);
    expect(svg).toContain('<path xmlns="http://www.w3.org/2000/svg" d="M0 0" style="animation:fm2-0 2s step-end infinite"/>');
    expect(svg).toContain('<path xmlns="http://www.w3.org/2000/svg" d="M1 1" style="animation:fm2-2 2s step-end infinite"/>');
    expect(svg).toContain('@keyframes fm2-0{0%{display:inline}50%{display:none}100%{display:none}}');
    expect(svg).toContain('@keyframes fm2-2{0%{display:none}50%{display:inline}100%{display:inline}}');
  });

  it('writes constant text as is and wraps text that changes', () => {
    const p = element(2, 1, { tag: 'p', children: [3, 4] });
    const svg = build([element(1, null, { children: [2] }), p, text(3, 2, track([0, 'Count: '])), text(4, 2, track([0, '1'], [2, '2 < 3']))]);
    expect(svg).toContain('<p>Count: <span style="animation:fm4-0 2s step-end infinite">1</span><span style="animation:fm4-2 2s step-end infinite">2 &lt; 3</span></p>');
    expect(svg).toContain('@keyframes fm4-0{0%{display:contents}50%{display:none}100%{display:none}}');
  });

  it('uses tspan for text inside SVG and hides text that comes and goes', () => {
    const label = element(2, 1, { namespace: SVG_NS, tag: 'text', children: [3], display: track([0, 'inline']) });
    const svg = build([element(1, null, { children: [2] }), label, text(3, 2, track([1, 'hi']), track([1, true], [2, false]))]);
    expect(svg).toContain('<text xmlns="http://www.w3.org/2000/svg"><tspan style="animation:fm3-1 2s step-end infinite">hi</tspan></text>');
    expect(svg).toContain('@keyframes fm3-1{0%{display:none}25%{display:inline}50%{display:none}100%{display:none}}');
  });

  it('closes HTML elements explicitly and drops scripts and event handlers', () => {
    const div = element(2, 1, { attributes: new Map([['onclick', track([0, 'x()'])], ['class', track([0, 'a'])]]) });
    const br = element(3, 1, { tag: 'br' });
    const script = element(4, 1, { tag: 'script', children: [5] });
    const svg = build([element(1, null, { children: [2, 3, 4] }), div, br, script, text(5, 4, track([0, 'alert(1)']))]);
    expect(svg).toContain('<div class="a"></div><br/>');
    expect(svg).not.toContain('script');
    expect(svg).not.toContain('onclick');
  });
});

describe('parseUnicodeRange', () => {
  it('reads single points, ranges and wildcards', () => {
    expect(parseUnicodeRange('U+0000-00FF, U+0131, U+02??')).toEqual([[0, 255], [305, 305], [512, 767]]);
    expect(parseUnicodeRange('u+1F600-1F64F')).toEqual([[0x1F600, 0x1F64F]]);
  });
});
