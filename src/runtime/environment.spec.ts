import { getEnvironment, resetEnvironment, setEnvironment } from './environment.js';


describe('environment', () => {
  beforeEach(() => {
    resetEnvironment();
  });

  it('defaults to player mode', () => {
    expect(getEnvironment()).toEqual({
      isStudio: false,
      isRendering: false,
      isPlayer: true,
    });
  });

  it('updates environment flags with setEnvironment', () => {
    setEnvironment({ isStudio: true, isPlayer: false });
    expect(getEnvironment()).toEqual({
      isStudio: true,
      isRendering: false,
      isPlayer: false,
    });

    setEnvironment({ isRendering: true });
    expect(getEnvironment()).toEqual({
      isStudio: true,
      isRendering: true,
      isPlayer: false,
    });
  });

  it('resets back to default with resetEnvironment', () => {
    setEnvironment({ isStudio: true, isPlayer: false });
    resetEnvironment();
    expect(getEnvironment()).toEqual({
      isStudio: false,
      isRendering: false,
      isPlayer: true,
    });
  });
});
