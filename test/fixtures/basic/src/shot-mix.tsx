import {
  AbsoluteFill,
  Audio,
  defineComposition,
  Freeze,
  getEnvironment,
  Sequence,
  staticFile,
  Video,
} from 'freemotion';


const size = { fps: 30, width: 64, height: 64 };

export const ShotMix = () => {
  const isStudio = getEnvironment().isStudio;

  return (
    <AbsoluteFill style={{ backgroundColor: '#000000' }}>
      {/* Sequence 1: frames 0-29 */}
      <Sequence from={0} durationInFrames={30}>
        <Video
          src={staticFile('skill/shot1.mp4')}
          trimBefore={10}
          playbackRate={1}
          style={{ width: '100%', height: '100%' }}
        />
        <Sequence from={15} durationInFrames={15}>
          <Audio src={staticFile('skill/narration1.wav')} />
        </Sequence>
      </Sequence>

      {/* Sequence 2: frames 30-59, wrapped in Freeze on its final frame */}
      <Sequence from={30} durationInFrames={30}>
        <Freeze frame={29}>
          <Video
            src={staticFile('skill/shot2.mp4')}
            trimBefore={5}
            playbackRate={1.5}
            style={{ width: '100%', height: '100%' }}
          />
          <Audio src={staticFile('skill/narration2.wav')} />
        </Freeze>
      </Sequence>

      {/* Sequence 3: frames 60-89 */}
      <Sequence from={60} durationInFrames={30}>
        <Video
          src={staticFile('skill/shot3.mp4')}
          trimBefore={0}
          playbackRate={2}
          style={{ width: '100%', height: '100%' }}
        />
        <Audio src={staticFile('skill/narration3.wav')} />
      </Sequence>

      {/* SFX in Sequence layout="none" with negative sequence start frame */}
      <Sequence from={-10} durationInFrames={15} layout="none">
        <Audio src={staticFile('skill/sfx.wav')} />
      </Sequence>

      {/* Background music track with loop: true and dynamic per-frame volume envelope (ducking and fade) */}
      <Audio
        src={staticFile('skill/music.wav')}
        loop
        volume={(f) => {
          if (f < 15) return 0;
          if (f < 30) return 0.15;
          if (f < 60) return 0.8;
          return 0.2;
        }}
      />

      {/* On-screen badge/watermark rendered conditionally only when getEnvironment().isStudio is true */}
      {isStudio && (
        <div
          id="studio-watermark"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: 16,
            height: 16,
            backgroundColor: '#ffff00',
            zIndex: 9999,
          }}
        />
      )}
    </AbsoluteFill>
  );
};

export const shotMixComposition = defineComposition({
  ...size,
  id: 'ShotMix',
  component: ShotMix,
  durationInFrames: 90,
});

export default shotMixComposition;
