import { AbsoluteFill, Audio, defineComposition, Sequence, staticFile, Video } from 'freemotion';


const size = { fps: 30, width: 64, height: 64 };

const NarrationAudio = () => (
  <AbsoluteFill style={{ backgroundColor: '#112233' }}>
    <Sequence from={30}>
      <Audio src={staticFile('clips/tone.wav')} />
    </Sequence>
  </AbsoluteFill>
);

const MusicEnvelope = () => (
  <AbsoluteFill style={{ backgroundColor: '#112233' }}>
    <Audio src={staticFile('clips/tone.wav')} volume={f => (f < 30 ? 1 : (f < 60 ? 0.2 : 0.8))} />
  </AbsoluteFill>
);

const SfxNegative = () => (
  <AbsoluteFill style={{ backgroundColor: '#112233' }}>
    <Sequence from={-15} durationInFrames={45} layout="none">
      <Audio src={staticFile('clips/tone.wav')} />
    </Sequence>
  </AbsoluteFill>
);

const NoAudio = () => (
  <AbsoluteFill style={{ backgroundColor: '#ff0000' }} />
);

const VideoWithAudio = () => (
  <AbsoluteFill>
    <Video
      src={staticFile('clips/clip_audio.mp4')}
      playbackRate={2}
      style={{ width: '100%', height: '100%' }}
    />
  </AbsoluteFill>
);

const MissingAudio = () => (
  <AbsoluteFill style={{ backgroundColor: '#112233' }}>
    <Audio src={staticFile('clips/missing_tone.wav')} />
  </AbsoluteFill>
);

export default [
  defineComposition({ ...size, id: 'NarrationAudio', component: NarrationAudio, durationInFrames: 60 }),
  defineComposition({ ...size, id: 'MusicEnvelope', component: MusicEnvelope, durationInFrames: 90 }),
  defineComposition({ ...size, id: 'SfxNegative', component: SfxNegative, durationInFrames: 30 }),
  defineComposition({ ...size, id: 'NoAudio', component: NoAudio, durationInFrames: 30 }),
  defineComposition({ ...size, id: 'VideoWithAudio', component: VideoWithAudio, durationInFrames: 30 }),
  defineComposition({ ...size, id: 'MissingAudio', component: MissingAudio, durationInFrames: 30 }),
];
