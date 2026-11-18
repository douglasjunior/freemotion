import { AbsoluteFill, defineComposition, staticFile, Video } from 'freemotion';


const size = { fps: 30, width: 64, height: 64 };

const SingleVideo = () => (
  <AbsoluteFill>
    <Video src={staticFile('clips/test.mp4')} style={{ width: '100%', height: '100%' }} />
  </AbsoluteFill>
);

const TwoVideos = () => (
  <AbsoluteFill>
    <Video src={staticFile('clips/test.mp4')} style={{ position: 'absolute', top: 0, left: 0, width: 32, height: 64 }} />
    <Video src={staticFile('clips/test.mp4')} style={{ position: 'absolute', top: 0, left: 32, width: 32, height: 64 }} />
  </AbsoluteFill>
);

const MissingClip = () => (
  <AbsoluteFill>
    <Video src={staticFile('clips/missing-clip-never-exists.mp4')} />
  </AbsoluteFill>
);

export default [
  defineComposition({ ...size, id: 'SingleVideo', component: SingleVideo, durationInFrames: 30 }),
  defineComposition({ ...size, id: 'TwoVideos', component: TwoVideos, durationInFrames: 10 }),
  defineComposition({ ...size, id: 'MissingClip', component: MissingClip, durationInFrames: 5 }),
];
