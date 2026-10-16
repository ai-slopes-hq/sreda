import type { JSX } from 'solid-js';

export type IconName =
  | 'search'
  | 'close'
  | 'save'
  | 'new'
  | 'dice'
  | 'sidebar'
  | 'minus'
  | 'plus'
  | 'fit'
  | 'undo'
  | 'speaker'
  | 'check'
  | 'chevron-down'
  | 'chevron-right'
  | 'import'
  | 'grip';

/** Stroked paths on a 24-unit grid; `fill` marks the dots drawn solid. */
const PATHS: Record<IconName, { d: string; dots?: [number, number][] }> = {
  search: { d: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM15.5 15.5 20 20' },
  close: { d: 'M6 6l12 12M18 6 6 18' },
  save: { d: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6' },
  new: { d: 'M6 3h8l4 4v14H6zM14 3v4h4M12 11v6M9 14h6' },
  dice: {
    d: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z',
    dots: [
      [8.5, 8.5],
      [15.5, 8.5],
      [12, 12],
      [8.5, 15.5],
      [15.5, 15.5],
    ],
  },
  sidebar: { d: 'M4 5h16v14H4zM15 5v14' },
  minus: { d: 'M5 12h14' },
  plus: { d: 'M12 5v14M5 12h14' },
  fit: { d: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5' },
  undo: { d: 'M9 7 4 12l5 5M4 12h10a6 6 0 0 1 0 8h-3' },
  speaker: { d: 'M4 10v4h4l5 4V6L8 10zM16.5 9a4 4 0 0 1 0 6M19 6.5a8 8 0 0 1 0 11' },
  check: { d: 'M5 12.5l4.5 4.5L19 7' },
  'chevron-down': { d: 'M6 9l6 6 6-6' },
  'chevron-right': { d: 'M9 6l6 6-6 6' },
  import: { d: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14' },
  grip: {
    d: '',
    dots: [
      [9, 6],
      [15, 6],
      [9, 12],
      [15, 12],
      [9, 18],
      [15, 18],
    ],
  },
};

/** An inline chrome icon: strokes in `currentColor`, 1.5 wide, no fill (dots of dice and grip are filled). */
export function Icon(props: { name: IconName; size?: number }): JSX.Element {
  const def = () => PATHS[props.name];
  return (
    <svg
      class="sr-icon"
      viewBox="0 0 24 24"
      width={props.size ?? 16}
      height={props.size ?? 16}
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={def().d} />
      {def().dots?.map(([cx, cy]) => <circle cx={cx} cy={cy} r="1" fill="currentColor" stroke="none" />)}
    </svg>
  );
}
