import { useLayoutEffect, useRef, type ImgHTMLAttributes } from 'react';

import { cancelRender, continueRender, delayRender } from './delay-render.js';


export type ImgProps = ImgHTMLAttributes<HTMLImageElement> & { readonly src: string };

/** An `<img>` that holds the render until the image has loaded, so no frame shows it half-drawn. */
export const Img = ({ src, ...props }: ImgProps) => {
  const ref = useRef<HTMLImageElement>(null);

  useLayoutEffect(() => {
    const img = ref.current;
    if (!img || (img.complete && img.naturalWidth > 0)) {
      return;
    }
    const handle = delayRender(`Loading <Img src="${src}">`);
    const onLoad = () => continueRender(handle);
    const onError = () => cancelRender(new Error(`freemotion: <Img> failed to load "${src}".`));
    img.addEventListener('load', onLoad);
    img.addEventListener('error', onError);
    return () => {
      img.removeEventListener('load', onLoad);
      img.removeEventListener('error', onError);
      continueRender(handle);
    };
  }, [src]);

  return <img ref={ref} src={src} {...props} />;
};
