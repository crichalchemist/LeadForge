import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

// The Scarlet Plate (DESIGN.md, The One Plate Rule): the one filled action on a screen. data-plate lets a
// test count them.
const plateClass =
  'inline-flex h-9 items-center gap-2 rounded-control bg-plate px-4 font-condensed text-label uppercase text-on-plate ' +
  'transition-colors duration-state ease-out-expo hover:bg-plate-deep disabled:cursor-not-allowed disabled:opacity-60';

export function Plate({ children, type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} data-plate="" className={plateClass} {...props}>
      {children}
    </button>
  );
}

/** A plate that navigates carries a trailing arrow (DESIGN.md, Buttons). */
export function PlateLink({ children, ...props }: LinkProps & { children: ReactNode }) {
  return (
    <Link data-plate="" className={plateClass} {...props}>
      {children}
      <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
    </Link>
  );
}
