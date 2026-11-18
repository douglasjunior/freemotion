# @freemotion/three

Use React Three Fiber scenes in a freemotion composition. Install `@freemotion/three` alongside its peer dependencies `freemotion`, `react`, `react-dom`, `three`, and `@react-three/fiber` (version 9).

```tsx
import { ThreeCanvas } from '@freemotion/three';
import { useCurrentFrame, useVideoConfig } from 'freemotion';

function Scene() {
  const frame = useCurrentFrame();
  return <mesh rotation-y={frame / 30}><boxGeometry /><meshStandardMaterial /></mesh>;
}

export function Composition() {
  const { width, height } = useVideoConfig();
  return <ThreeCanvas width={width} height={height} camera={{ position: [0, 0, 5] }}><ambientLight /><Scene /></ThreeCanvas>;
}
```

`width` and `height` set the composition size in pixels. `camera`, `gl`, `onCreated`, `style`, `className`, and other Canvas props configure the scene. The frame loop is controlled by freemotion; `frameloop` cannot be overridden. On headless systems, render with `--gl swangle` if WebGL initialization fails.

Suspending assets loaded with `useLoader` hold the render until they resolve. Child errors cancel the render. `useCurrentFrame` and other freemotion hooks are available inside the canvas; derive animation from the frame for deterministic output.
