import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { FileText, Landmark, LayoutDashboard, ListOrdered, Map as MapIcon, Menu, Workflow, X, type LucideIcon } from 'lucide-react';

export interface Station {
  to: string;
  label: string;
  icon: LucideIcon;
}

// Destinations as stations on one vertical line (DESIGN.md, Navigation). Leads comes first, where the core
// loop starts. Dashboard, Pipeline, Grants and Reports are the old pages, ordinary stations until wave 2
// replaces each. Map is planned track: drawn and named, but not a link.
export const STATIONS: Station[] = [
  { to: '/leads', label: 'Leads', icon: ListOrdered },
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/pipeline', label: 'Pipeline', icon: Workflow },
  { to: '/grants', label: 'Grants', icon: Landmark },
  { to: '/reports', label: 'Reports', icon: FileText },
];
const PLANNED = [{ label: 'Map', icon: MapIcon }];

// From 900px to 1199px the rail is 64px of icons, and a station's name appears beside it on focus, floating
// over the page, which is the one kind of surface that may cast a shadow (DESIGN.md, The Flat Enamel Rule).
const CONDENSED_LABEL =
  'rail:max-wide:sr-only rail:max-wide:group-focus-visible:not-sr-only rail:max-wide:group-focus-visible:absolute ' +
  'rail:max-wide:group-focus-visible:left-full rail:max-wide:group-focus-visible:ml-2 rail:max-wide:group-focus-visible:whitespace-nowrap ' +
  'rail:max-wide:group-focus-visible:rounded-control rail:max-wide:group-focus-visible:bg-raised rail:max-wide:group-focus-visible:px-2 ' +
  'rail:max-wide:group-focus-visible:py-1 rail:max-wide:group-focus-visible:text-text rail:max-wide:group-focus-visible:shadow-overlay';

function Tick({ current }: { current: boolean }) {
  return current ? (
    <span aria-hidden="true" className="relative z-[1] h-3.5 w-3.5 shrink-0 rounded-full border-[3px] border-text bg-raised" />
  ) : (
    <span aria-hidden="true" className="relative z-[1] mx-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-dim ring-2 ring-raised" />
  );
}

export function LineRail({ footer }: { footer: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <header className="border-b border-seam bg-raised rail:sticky rail:top-0 rail:flex rail:h-screen rail:w-16 rail:shrink-0 rail:flex-col rail:border-b-0 rail:border-r wide:w-60">
      <div className="flex items-center justify-between px-4 py-3 rail:py-5">
        <span className="font-condensed text-title uppercase">
          <span className="rail:max-wide:sr-only">LeadForge</span>
          <span aria-hidden="true" className="hidden rail:max-wide:inline">LF</span>
        </span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="stations"
          onClick={() => setOpen((value) => !value)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-control border border-edge rail:hidden"
        >
          {open ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
          <span className="sr-only">{open ? 'Close stations' : 'Open stations'}</span>
        </button>
      </div>

      <nav id="stations" aria-label="Stations" className={`${open ? 'block' : 'hidden'} flex-1 px-2 pb-4 rail:block`}>
        <ol className="relative space-y-1 before:absolute before:bottom-3 before:left-[23px] before:top-3 before:w-0.5 before:bg-edge">
          {STATIONS.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                onClick={() => setOpen(false)}
                className="group relative flex items-center gap-3 rounded-control px-3 py-2 font-condensed text-label uppercase text-dim transition-colors duration-state ease-out-expo hover:text-text aria-[current=page]:text-text"
              >
                {({ isActive }) => (
                  <>
                    <Tick current={isActive} />
                    <Icon size={16} strokeWidth={2} aria-hidden="true" className="shrink-0" />
                    <span className={CONDENSED_LABEL}>{label}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
          {PLANNED.map(({ label, icon: Icon }) => (
            <li key={label} className="relative flex items-center gap-3 px-3 py-2 font-condensed text-label uppercase text-dim">
              <span aria-hidden="true" className="relative z-[1] mx-0.5 h-2.5 w-2.5 shrink-0 rounded-full border-2 border-dashed border-edge bg-raised" />
              <Icon size={16} strokeWidth={2} aria-hidden="true" className="shrink-0" />
              <span className="rail:max-wide:sr-only">{label}</span>
              <span className="sr-only">, planned, not built yet</span>
            </li>
          ))}
        </ol>
      </nav>

      <div className={`${open ? 'block' : 'hidden'} border-t border-seam px-4 py-3 rail:block rail:max-wide:px-2`}>{footer}</div>
    </header>
  );
}
