import { defineComposition, validateCompositions } from './composition.js';


const Empty = () => null;
const base = { id: 'Intro', component: Empty, fps: 30, width: 1920, height: 1080, durationInFrames: 90 };

describe('defineComposition', () => {
  it('fills defaultProps', () => {
    expect(defineComposition(base).defaultProps).toEqual({});
  });

  it('keeps the definition', () => {
    const Title = ({ text }: { text: string }) => text;
    const composition = defineComposition({ ...base, component: Title, defaultProps: { text: 'hi' }, folder: 'Demos' });
    expect(composition).toMatchObject({ id: 'Intro', folder: 'Demos', defaultProps: { text: 'hi' } });
  });

  it.each([
    [{ id: 'has space' }, /id must use only/],
    [{ id: '' }, /id must use only/],
    [{ fps: 0 }, /fps must be positive/],
    [{ width: 10.5 }, /width must be a positive integer/],
    [{ height: -1 }, /height must be a positive integer/],
    [{ durationInFrames: 0 }, /durationInFrames must be a positive integer/],
  ])('rejects %o', (override, message) => {
    expect(() => defineComposition({ ...base, ...override })).toThrow(message);
  });
});

describe('validateCompositions', () => {
  it('accepts a list of compositions', () => {
    const list = [defineComposition(base), defineComposition({ ...base, id: 'Outro' })];
    expect(validateCompositions(list)).toBe(list);
  });

  it('needs an array', () => {
    expect(() => validateCompositions({})).toThrow(/export default/);
  });

  it('needs items from defineComposition', () => {
    expect(() => validateCompositions([{ id: 'x' }])).toThrow(/defineComposition/);
  });

  it('needs unique ids', () => {
    expect(() => validateCompositions([defineComposition(base), defineComposition(base)])).toThrow(/share the id "Intro"/);
  });
});
