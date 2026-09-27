import type { Source } from '../types';

const ORDER: Source[] = ['license', 'google', 'overture'];
const LETTER: Record<Source, string> = { license: 'L', google: 'G', overture: 'O' };
export const SOURCE_NAME: Record<Source, string> = { license: 'City licence', google: 'Google Places', overture: 'Overture' };

/** Lettered roundels after a fact, always in L, G, O order (DESIGN.md, Chips). The letter is for the eye,
 *  the name for a screen reader. Renders nothing for an empty list: the caller words that case. */
export function SourceBullets({ sources }: { sources: Source[] }) {
  if (sources.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      {ORDER.filter((source) => sources.includes(source)).map((source) => (
        <span
          key={source}
          title={SOURCE_NAME[source]}
          className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border border-text font-condensed text-label leading-none text-text"
        >
          <span aria-hidden="true">{LETTER[source]}</span>
          <span className="sr-only">{SOURCE_NAME[source]}</span>
        </span>
      ))}
    </span>
  );
}
