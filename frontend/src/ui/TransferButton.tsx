import type { ButtonHTMLAttributes } from 'react';

// The secondary control: transparent, a 1px control edge, a label in the text color, and hover filling
// with the raised region (DESIGN.md, Buttons). Every action that is not the plate uses it.
export const secondaryClass =
  'inline-flex h-9 items-center gap-2 rounded-control border border-edge px-[15px] font-condensed text-label uppercase ' +
  'text-text transition-colors duration-state ease-out-expo hover:bg-raised disabled:cursor-not-allowed disabled:opacity-60';

/** A stage move as an explicit control that names its destination, never drag alone (WCAG 2.5.7). */
export function TransferButton({ to, ...props }: { to: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={secondaryClass} {...props}>
      Transfer to {to}
    </button>
  );
}
