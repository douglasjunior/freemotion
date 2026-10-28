import { timecode } from './studio.js';


describe('timecode', () => {
  it('formats minutes, seconds and frames', () => {
    expect(timecode(0, 30)).toBe('0:00.00');
    expect(timecode(29, 30)).toBe('0:00.29');
    expect(timecode(30, 30)).toBe('0:01.00');
    expect(timecode(30 * 75 + 4, 30)).toBe('1:15.04');
  });
});
