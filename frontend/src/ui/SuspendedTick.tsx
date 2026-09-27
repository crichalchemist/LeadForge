/** A suspended station: a hollow tick with the line broken on either side, and the reason in words
 *  (DESIGN.md, Shapes). Stands where a value could not be measured. */
export function SuspendedTick({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-dim">
      <svg width="30" height="10" viewBox="0 0 30 10" aria-hidden="true" className="shrink-0 stroke-edge">
        <line x1="0" y1="5" x2="7" y2="5" strokeWidth="2" />
        <circle cx="15" cy="5" r="4" fill="none" strokeWidth="2" />
        <line x1="23" y1="5" x2="30" y2="5" strokeWidth="2" />
      </svg>
      <span>{label}</span>
    </span>
  );
}
