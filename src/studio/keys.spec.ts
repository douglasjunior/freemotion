import { describe, expect, it } from 'vitest';

import { keyAction, type KeyContext } from './keys.js';


describe('keyAction', () => {
  const ctx: KeyContext = {
    fps: 30,
    frame: 50,
    last: 100,
  };

  it('maps space to toggle-play', () => {
    expect(keyAction({ key: ' ' }, ctx)).toEqual({ type: 'toggle-play' });
  });

  it('maps ArrowLeft to 1 frame backward', () => {
    expect(keyAction({ key: 'ArrowLeft' }, ctx)).toEqual({ type: 'seek', frame: 49 });
    expect(keyAction({ key: 'ArrowLeft' }, { ...ctx, frame: 0 })).toEqual({ type: 'seek', frame: 0 });
  });

  it('maps ArrowRight to 1 frame forward', () => {
    expect(keyAction({ key: 'ArrowRight' }, ctx)).toEqual({ type: 'seek', frame: 51 });
    expect(keyAction({ key: 'ArrowRight' }, { ...ctx, frame: 100 })).toEqual({ type: 'seek', frame: 100 });
  });

  it('maps Shift+ArrowLeft to fps frames backward (1 second)', () => {
    expect(keyAction({ key: 'ArrowLeft', shiftKey: true }, ctx)).toEqual({ type: 'seek', frame: 20 });
    expect(keyAction({ key: 'ArrowLeft', shiftKey: true }, { ...ctx, frame: 10 })).toEqual({ type: 'seek', frame: 0 });
  });

  it('maps Shift+ArrowRight to fps frames forward (1 second)', () => {
    expect(keyAction({ key: 'ArrowRight', shiftKey: true }, ctx)).toEqual({ type: 'seek', frame: 80 });
    expect(keyAction({ key: 'ArrowRight', shiftKey: true }, { ...ctx, frame: 90 })).toEqual({ type: 'seek', frame: 100 });
  });

  it('maps Home to frame 0 and End to last frame', () => {
    expect(keyAction({ key: 'Home' }, ctx)).toEqual({ type: 'seek', frame: 0 });
    expect(keyAction({ key: 'End' }, ctx)).toEqual({ type: 'seek', frame: 100 });
  });

  it('maps l and L to toggle-loop', () => {
    expect(keyAction({ key: 'l' }, ctx)).toEqual({ type: 'toggle-loop' });
    expect(keyAction({ key: 'L' }, ctx)).toEqual({ type: 'toggle-loop' });
  });

  it('maps m and M to toggle-mute', () => {
    expect(keyAction({ key: 'm' }, ctx)).toEqual({ type: 'toggle-mute' });
    expect(keyAction({ key: 'M' }, ctx)).toEqual({ type: 'toggle-mute' });
  });

  it('ignores Ctrl and Meta modifier combinations', () => {
    expect(keyAction({ key: ' ', ctrlKey: true }, ctx)).toBeNull();
    expect(keyAction({ key: ' ', metaKey: true }, ctx)).toBeNull();
    expect(keyAction({ key: 'ArrowLeft', ctrlKey: true }, ctx)).toBeNull();
    expect(keyAction({ key: 'ArrowRight', metaKey: true }, ctx)).toBeNull();
    expect(keyAction({ key: 'l', ctrlKey: true }, ctx)).toBeNull();
  });

  it('ignores events targeting input, select, textarea, or contentEditable elements', () => {
    expect(keyAction({ key: ' ', target: { tagName: 'INPUT' } as unknown as EventTarget }, ctx)).toBeNull();
    expect(keyAction({ key: ' ', target: { tagName: 'SELECT' } as unknown as EventTarget }, ctx)).toBeNull();
    expect(keyAction({ key: ' ', target: { tagName: 'TEXTAREA' } as unknown as EventTarget }, ctx)).toBeNull();
    expect(keyAction({ key: 'ArrowLeft', target: { isContentEditable: true } as unknown as EventTarget }, ctx)).toBeNull();
  });

  it('returns null for unknown keys', () => {
    expect(keyAction({ key: 'a' }, ctx)).toBeNull();
    expect(keyAction({ key: 'Enter' }, ctx)).toBeNull();
    expect(keyAction({ key: 'Escape' }, ctx)).toBeNull();
  });
});
