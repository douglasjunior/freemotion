export type KeyAction =
  | { readonly type: 'toggle-play' }
  | { readonly type: 'seek'; readonly frame: number }
  | { readonly type: 'toggle-loop' }
  | { readonly type: 'toggle-mute' };

export type KeyContext = {
  readonly fps: number;
  readonly frame: number;
  readonly last: number;
};

export type KeyboardEventLike = {
  readonly key: string;
  readonly shiftKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly target?: EventTarget | null;
};

function isEditableTarget(target?: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') {
    return false;
  }
  const el = target as { tagName?: string; isContentEditable?: boolean };
  const tag = el.tagName?.toUpperCase();
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || Boolean(el.isContentEditable);
}

/**
 * Pure function mapping keyboard events to Studio playback and navigation actions.
 * Ignores events with Ctrl/Meta modifiers or targeting input fields.
 */
export function keyAction(event: KeyboardEventLike, { fps, frame, last }: KeyContext): KeyAction | null {
  if (event.ctrlKey || event.metaKey || isEditableTarget(event.target)) {
    return null;
  }

  const step = event.shiftKey ? fps : 1;

  switch (event.key) {
    case ' ':
      return { type: 'toggle-play' };
    case 'ArrowLeft':
      return { type: 'seek', frame: Math.max(0, frame - step) };
    case 'ArrowRight':
      return { type: 'seek', frame: Math.min(last, frame + step) };
    case 'Home':
      return { type: 'seek', frame: 0 };
    case 'End':
      return { type: 'seek', frame: last };
    case 'l':
    case 'L':
      return { type: 'toggle-loop' };
    case 'm':
    case 'M':
      return { type: 'toggle-mute' };
    default:
      return null;
  }
}
