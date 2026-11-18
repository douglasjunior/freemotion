export type Environment = {
  readonly isStudio: boolean;
  readonly isRendering: boolean;
  readonly isPlayer: boolean;
};

const DEFAULT_ENVIRONMENT: Environment = {
  isStudio: false,
  isRendering: false,
  isPlayer: true,
};

let currentEnvironment: Environment = { ...DEFAULT_ENVIRONMENT };

/** Returns the current execution environment (`isStudio`, `isRendering`, `isPlayer`). */
export function getEnvironment(): Environment {
  return currentEnvironment;
}

/** Set environment flags (internal). */
export function setEnvironment(partial: Partial<Environment>): void {
  currentEnvironment = { ...currentEnvironment, ...partial };
}

/** Reset environment flags back to default (internal / testing). */
export function resetEnvironment(): void {
  currentEnvironment = { ...DEFAULT_ENVIRONMENT };
}
