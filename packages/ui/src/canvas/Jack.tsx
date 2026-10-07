import type { Role } from '@sreda/core';
import type { JSX } from 'solid-js';
import { ROLE } from './glyphs';

export interface JackProps {
  port: string;
  dir: 'in' | 'out';
  role: Role;
  x: number;
  y: number;
  /** filled: cabled (inputs) or connected (outputs) */
  filled: boolean;
  /** dashed: an unpatched input reading its normal */
  normalled?: boolean;
  mod?: boolean;
  /** this output is being listened to */
  listening?: boolean;
  title?: string | undefined;
  ref?: (el: HTMLDivElement) => void;
  onPointerDown?: (e: PointerEvent) => void;
}

export function Jack(props: JackProps): JSX.Element {
  return (
    <div
      ref={props.ref}
      class="sr-jack"
      data-jack={props.port}
      data-dir={props.dir}
      data-mod={props.mod ? '' : undefined}
      title={props.title}
      onPointerDown={(e) => {
        e.stopPropagation();
        props.onPointerDown?.(e);
      }}
      style={{
        left: props.x - 5.5 + 'px',
        top: props.y - 5.5 + 'px',
        'border-color': ROLE[props.role],
        'border-style': props.normalled ? 'dashed' : 'solid',
        background: props.filled ? ROLE[props.role] : '#121210',
        'box-shadow': props.listening ? `0 0 0 2px #121210, 0 0 0 3.5px ${ROLE[props.role]}` : undefined,
      }}
    />
  );
}
