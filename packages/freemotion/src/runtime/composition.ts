import type { ComponentType } from 'react';

import type { VideoConfig } from './frame.js';


type AnyProps = Record<string, unknown>;

export type Composition<Props extends object = AnyProps> = VideoConfig & {
  /** Unique name, used by the studio URL and by `freemotion render <id>`. */
  readonly id: string;
  readonly component: ComponentType<Props>;
  readonly defaultProps: Props;
  /** Groups compositions in the studio's picker. */
  readonly folder?: string;
};

export type CompositionDefinition<Props extends object> = VideoConfig & {
  readonly id: string;
  readonly component: ComponentType<Props>;
  readonly folder?: string;
} & (Partial<Props> extends Props ? { readonly defaultProps?: Props } : { readonly defaultProps: Props });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyComposition = Composition<any>;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function positiveInteger(value: number) {
  return Number.isInteger(value) && value > 0;
}

/** Declares a video: what to draw, at which size and frame rate, and for how long. */
export function defineComposition<Props extends object = AnyProps>(definition: CompositionDefinition<Props>): Composition<Props> {
  const { id, fps, width, height, durationInFrames } = definition;
  const problems = [
    !ID_PATTERN.test(id) && `id must use only letters, digits, "-" and "_" (got "${id}")`,
    !(fps > 0) && `fps must be positive (got ${fps})`,
    !positiveInteger(width) && `width must be a positive integer (got ${width})`,
    !positiveInteger(height) && `height must be a positive integer (got ${height})`,
    !positiveInteger(durationInFrames) && `durationInFrames must be a positive integer (got ${durationInFrames})`,
  ].filter(Boolean);
  if (problems.length > 0) {
    throw new Error(`freemotion: invalid composition "${id}": ${problems.join('; ')}.`);
  }
  return { ...definition, defaultProps: (definition.defaultProps ?? {}) as Props };
}

/** Checks the list a project exports: it must be an array of compositions with unique ids. */
export function validateCompositions(value: unknown): readonly AnyComposition[] {
  if (!Array.isArray(value)) {
    throw new Error('freemotion: the entry file must `export default` an array of compositions created with defineComposition().');
  }
  const seen = new Set<string>();
  for (const item of value as AnyComposition[]) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || typeof item.component !== 'function') {
      throw new Error('freemotion: every item exported by the entry file must come from defineComposition().');
    }
    if (seen.has(item.id)) {
      throw new Error(`freemotion: two compositions share the id "${item.id}".`);
    }
    seen.add(item.id);
  }
  return value as AnyComposition[];
}
