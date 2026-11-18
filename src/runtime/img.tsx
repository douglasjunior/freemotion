import { useLayoutEffect, useRef, type ImgHTMLAttributes } from 'react';

import { cancelRender, continueRender, delayRender } from './delay-render.js';


export type ImgProps = ImgHTMLAttributes<HTMLImageElement> & {
  readonly src: string;
  readonly label?: string;
};

/** An `<img>` that holds the render until the image has loaded, so no frame shows it half-drawn. */
export const Img = ({ src, label, ...props }: ImgProps) => {
  const ref = useRef<HTMLImageElement>(null);

  useLayoutEffect(() => {
    const img = ref.current;
    if (!img || (img.complete && img.naturalWidth > 0)) {
      return;
    }
    let cancelled = false;
    const handle = delayRender(label ?? `Loading <Img src="${src}">`);
    const onLoad = () => continueRender(handle);
    const onError = async () => {
      let detail = '';
      try {
        const response = await fetch(src);
        if (!response.ok) {
          detail = (await response.text()).trim();
        }
      } catch {
        // Fall back to default error message if fetch fails
      }
      if (!cancelled) {
        const detailSuffix = detail ? `: ${detail}` : '.';
        cancelRender(new Error(label ? `freemotion: ${label} failed to load "${src}"${detailSuffix}` : `freemotion: <Img> failed to load "${src}"${detailSuffix}`));
      }
    };
    img.addEventListener('load', onLoad);
    img.addEventListener('error', onError);
    return () => {
      cancelled = true;
      img.removeEventListener('load', onLoad);
      img.removeEventListener('error', onError);
      continueRender(handle);
    };
  }, [src, label]);

  return <img ref={ref} src={src} {...props} />;
};
