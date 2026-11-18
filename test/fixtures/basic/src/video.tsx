import { AbsoluteFill, defineComposition, Sequence, staticFile, Video } from 'freemotion';


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

type VideoPlaybackRateProps = {
  playbackRate?: number;
  trimBefore?: number;
};

const VideoPlaybackRate = ({ playbackRate = 1, trimBefore = 0 }: VideoPlaybackRateProps) => (
  <AbsoluteFill>
    <Video
      src={staticFile('clips/clipA.mp4')}
      trimBefore={trimBefore}
      playbackRate={playbackRate}
      style={{ width: '100%', height: '100%' }}
    />
  </AbsoluteFill>
);

const VideoCuts = () => (
  <AbsoluteFill>
    <Sequence from={0} durationInFrames={15}>
      <Video src={staticFile('clips/clipA.mp4')} trimBefore={0} style={{ width: '100%', height: '100%' }} />
    </Sequence>
    <Sequence from={15} durationInFrames={15}>
      <Video src={staticFile('clips/clipA.mp4')} trimBefore={60} style={{ width: '100%', height: '100%' }} />
    </Sequence>
  </AbsoluteFill>
);

const VideoAlphaWebm = () => (
  <AbsoluteFill style={{ backgroundColor: '#ff0000' }}>
    <Video
      src={staticFile('clips/alpha_circle.webm')}
      transparent
      style={{ width: '100%', height: '100%' }}
    />
  </AbsoluteFill>
);

const VideoAlphaProRes = () => (
  <AbsoluteFill style={{ backgroundColor: '#ff0000' }}>
    <Video
      src={staticFile('clips/alpha_circle.mov')}
      transparent
      style={{ width: '100%', height: '100%' }}
    />
  </AbsoluteFill>
);

export default [
  defineComposition({ ...size, id: 'SingleVideo', component: SingleVideo, durationInFrames: 30 }),
  defineComposition({ ...size, id: 'TwoVideos', component: TwoVideos, durationInFrames: 10 }),
  defineComposition({ ...size, id: 'MissingClip', component: MissingClip, durationInFrames: 5 }),
  defineComposition({
    ...size,
    id: 'VideoPlaybackRate',
    component: VideoPlaybackRate,
    durationInFrames: 30,
    defaultProps: { playbackRate: 1, trimBefore: 0 },
  }),
  defineComposition({ ...size, id: 'VideoCuts', component: VideoCuts, durationInFrames: 30 }),
  defineComposition({ ...size, id: 'VideoAlphaWebm', component: VideoAlphaWebm, durationInFrames: 10 }),
  defineComposition({ ...size, id: 'VideoAlphaProRes', component: VideoAlphaProRes, durationInFrames: 10 }),
];
