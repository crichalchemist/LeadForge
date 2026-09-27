import type { ReactNode } from 'react';

// Dashboard, Pipeline, Grants, Reports and, until they are replaced, the old Leads pages predate the Loop
// Diagram. They set gray-900 text on the gray-50 ground they assumed, which on midnight enamel would fail
// contrast outright. Until wave 2 replaces each one, it renders on that ground in both themes (spec
// 2026-09-26: old pages run as ordinary stations). Delete this component with the last old page.
export default function LegacySurface({ children }: { children: ReactNode }) {
  return (
    <div data-legacy-surface="" className="min-h-screen bg-gray-50 p-6 text-gray-900">
      {children}
    </div>
  );
}
