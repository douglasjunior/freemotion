import { sourceFrameIndex, sourceTimeFromIndex } from './frame-math.js';


describe('frame-math', () => {
  it('maps arbitrary time to source frame grid (e.g. 60 fps source, 30 fps comp)', () => {
    const sourceFps = 60;
    const compFps = 30;

    // Frame 0 in 30 fps (t = 0s) -> frame 0 in 60 fps
    expect(sourceFrameIndex(0 / compFps, sourceFps)).toBe(0);

    // Frame 1 in 30 fps (t = 1/30 = 0.0333...s) -> frame 2 in 60 fps
    expect(sourceFrameIndex(1 / compFps, sourceFps)).toBe(2);

    // Frame 2 in 30 fps (t = 2/30 = 0.0666...s) -> frame 4 in 60 fps
    expect(sourceFrameIndex(2 / compFps, sourceFps)).toBe(4);

    // Frame 15 in 30 fps (t = 0.5s) -> frame 30 in 60 fps
    expect(sourceFrameIndex(15 / compFps, sourceFps)).toBe(30);
  });

  it('handles fractional framerates like 29.97', () => {
    const fps = 29.97;
    // t = 1.0s -> ~30 frames
    expect(sourceFrameIndex(1.0, fps)).toBe(30);
    // t = 100 / 29.97 s -> frame 100
    expect(sourceFrameIndex(100 / fps, fps)).toBe(100);
  });

  it('clamps negative time to frame 0', () => {
    expect(sourceFrameIndex(-0.5, 30)).toBe(0);
    expect(sourceFrameIndex(-10, 60)).toBe(0);
  });

  it('converts frame index back to presentation time', () => {
    expect(sourceTimeFromIndex(0, 30)).toBe(0);
    expect(sourceTimeFromIndex(30, 30)).toBe(1.0);
    expect(sourceTimeFromIndex(60, 60)).toBe(1.0);
  });
});
