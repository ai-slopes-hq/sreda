import type { JSX } from 'solid-js';
import { Icon } from '../canvas/icons';

/** The filter field every list tab starts with: a search icon, Sans text; Esc clears it (spec §1b). */
export function SearchField(props: {
  value: string;
  set(v: string): void;
  placeholder: string;
  label: string;
}): JSX.Element {
  return (
    <label class="sr-sfield">
      <Icon name="search" size={15} />
      <input
        placeholder={props.placeholder}
        aria-label={props.label}
        value={props.value}
        onInput={(e) => props.set(e.currentTarget.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') {
            props.set('');
            e.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

/** A tab's last line. */
export function SideFooter(props: { children: JSX.Element }): JSX.Element {
  return <footer class="sr-sfoot">{props.children}</footer>;
}
