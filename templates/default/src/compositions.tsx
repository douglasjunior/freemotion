import { defineComposition } from 'freemotion';

import { HelloWorld, type HelloWorldProps } from './HelloWorld';
import { STEP_DURATION, Story, type StoryProps } from './Story';


export const helloWorld = defineComposition<HelloWorldProps>({
  id: 'HelloWorld',
  component: HelloWorld,
  defaultProps: { title: 'Hello, freemotion', subtitle: 'Videos made with React.' },
  fps: 30,
  width: 1920,
  height: 1080,
  durationInFrames: 120,
});

const steps: StoryProps['steps'] = [
  { title: 'Write it in React', text: 'Components, props and CSS. Every frame is a function of time.' },
  { title: 'Preview it live', text: 'The studio reloads as you type and jumps to any frame.' },
  { title: 'Render or scroll it', text: 'Export an MP4, or play it on a page as visitors scroll.' },
];

export const story = defineComposition<StoryProps>({
  id: 'Story',
  component: Story,
  defaultProps: { steps },
  fps: 30,
  width: 1280,
  height: 720,
  durationInFrames: steps.length * STEP_DURATION,
});

// Every composition the studio shows and `freemotion render <id>` can render.
export default [helloWorld, story];
