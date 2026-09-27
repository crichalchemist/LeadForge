import { secondaryClass } from './TransferButton';

/** A failed request, shown in its own region: what failed, and a way to try again (spec 2026-09-26, States). */
export function InlineError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div role="alert" className="mt-3 flex flex-wrap items-center gap-3">
      <span className="text-error">Couldn’t load {what}.</span>
      <button type="button" className={secondaryClass} onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}
