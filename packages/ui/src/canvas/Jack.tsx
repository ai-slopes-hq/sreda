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
  /** a WIRES port list's candidate: an amber ring */
  ring?: boolean;
  title?: string | undefined;
  ref?: (el: HTMLDivElement) => void;
  onPointerDown?: (e: PointerEvent) => void;
}

/** The patched inset fill and, over it, the ring of a listened or WIRES-highlighted jack. */
export function jackShadow(p: Pick<JackProps, 'role' | 'filled' | 'listening' | 'ring'>): string | undefined {
  const parts: string[] = [];
  if (p.ring) parts.push('0 0 0 2px var(--ground), 0 0 0 3.5px var(--accent)');
  else if (p.listening) parts.push(`0 0 0 2px var(--ground), 0 0 0 3.5px ${ROLE[p.role]}`);
  // an inset shadow paints over the background, so the outer ring and the fill compose
  if (p.filled) parts.push(`inset 0 0 0 2.5px ${ROLE[p.role]}`);
  return parts.length ? parts.join(', ') : undefined;
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
        left: props.x - 7 + 'px',
        top: props.y - 7 + 'px',
        'border-color': ROLE[props.role],
        'border-style': props.normalled ? 'dashed' : 'solid',
        background: 'var(--ground)',
        'box-shadow': jackShadow(props),
      }}
    />
  );
}
