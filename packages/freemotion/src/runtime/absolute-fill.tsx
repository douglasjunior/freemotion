import type { HTMLAttributes } from 'react';


export type AbsoluteFillProps = HTMLAttributes<HTMLDivElement>;

/** A layer that covers its parent: absolutely positioned, full size, flex column. */
export const AbsoluteFill = ({ style, ...props }: AbsoluteFillProps) => (
  <div
    {...props}
    style={{
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      ...style,
    }}
  />
);
