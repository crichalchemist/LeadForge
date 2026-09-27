import type { ReactNode, SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';

/** DESIGN.md, Inputs: raised fill, a 1px control edge, a 6px corner, 36px tall. The edge takes the text
 *  color on focus and the error color when invalid. */
export const inputClass =
  'h-9 rounded-control border border-edge bg-raised px-3 text-body text-text focus-visible:border-text aria-[invalid=true]:border-error';

/** A labelled field and its error, which names the fix. The control sets its own aria-invalid and
 *  aria-describedby (`${id}-error`). */
export function Field({ id, label, error, children }: { id: string; label: string; error: string | null; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="font-condensed text-label uppercase text-dim">{label}</label>
      <div className="mt-1">{children}</div>
      {error && <p id={`${id}-error`} className="mt-1 text-error">{error}</p>}
    </div>
  );
}

/** A select drawn as the other inputs are, with its own chevron in the text color instead of the browser's
 *  arrow, which belongs to no theme. `className` sizes the control's box. */
export function Select({ className = '', children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={`relative inline-block ${className}`}>
      <select className={`${inputClass} w-full appearance-none pr-9`} {...props}>
        {children}
      </select>
      <ChevronDown
        size={16}
        strokeWidth={2}
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text"
      />
    </span>
  );
}
