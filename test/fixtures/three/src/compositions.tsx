import { ThreeCanvas } from '@freemotion/three';
import { useLoader } from '@react-three/fiber';
import { defineComposition, staticFile, useCurrentFrame } from 'freemotion';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';


function CubeScene() {
  const frame = useCurrentFrame();
  return <mesh rotation={[frame / 20, frame / 15, 0]}><boxGeometry /><meshNormalMaterial /></mesh>;
}

function Cube() {
  return <ThreeCanvas width={128} height={128} camera={{ position: [0, 0, 4] }}><CubeScene /></ThreeCanvas>;
}

const cube = defineComposition({ id: 'Cube', component: Cube, width: 128, height: 128, fps: 30, durationInFrames: 10 });

function Delayed() {
  const model = useLoader(GLTFLoader, staticFile('model.glb'));
  return <primitive object={model.scene} />;
}
function Model() {
  return <ThreeCanvas width={128} height={128} camera={{ position: [0, 0, 4] }}><ambientLight intensity={3} /><Delayed /></ThreeCanvas>;
}
function Broken(): never {
  throw new Error('Three fixture error');
}
function ErrorScene() {
  return <ThreeCanvas width={128} height={128}><Broken /></ThreeCanvas>;
}
export const extra = [
  defineComposition({ id: 'Model', component: Model, width: 128, height: 128, fps: 30, durationInFrames: 2 }),
  defineComposition({ id: 'ErrorScene', component: ErrorScene, width: 128, height: 128, fps: 30, durationInFrames: 2 }),
];

export default [cube, ...extra];
