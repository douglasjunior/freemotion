# My video

Made with [freemotion](https://github.com/douglasjunior/freemotion).

```bash
npm run studio        # preview every composition with hot reload
npm run render        # out/HelloWorld.mp4
npm run render:all    # every composition, to out/
npm run page          # a page that plays the Story video as you scroll
npm run page:build    # static build of that page, in page/dist
```

More render options:

```bash
npx freemotion render Story -o story.gif --scale 0.5 --every-nth-frame 2
npx freemotion render HelloWorld --props '{"title":"Hi there"}'
npx freemotion render HelloWorld --frame 60     # out/HelloWorld.png
```

## What's inside

| Path | |
|---|---|
| `src/compositions.tsx` | The list of compositions: size, frame rate, duration and default props |
| `src/HelloWorld.tsx` | Springs, `interpolate()` and a `<Sequence>` |
| `src/Story.tsx` | Steps played one after the other with `<Series>` |
| `page/` | A Vite page that plays `Story` with `<ScrollPlayer>` |

Videos are encoded with the ffmpeg binary from the `ffmpeg-static` dependency (GPL-licensed, see its README); remove it to use an ffmpeg installed on your system instead.
