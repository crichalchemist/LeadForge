import type { ReactNode } from 'react';

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
