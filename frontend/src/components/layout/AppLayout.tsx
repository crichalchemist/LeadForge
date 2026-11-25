import type { ReactNode } from 'react';
import { LogOut } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { LineRail } from '../../ui/LineRail';
import { ThemeToggle } from '../../ui/ThemeToggle';

export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-ground text-text rail:flex">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-10 focus:rounded-control focus:bg-raised focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <LineRail
        footer={
          <>
            <ThemeToggle />
            {user && (
              <div className="mt-4 flex items-center justify-between gap-2">
                <span className="min-w-0 rail:max-wide:sr-only">
                  <span className="block truncate text-text">{user.full_name}</span>
                  <span className="font-condensed text-label uppercase text-dim">{user.role}</span>
                </span>
                <button
                  type="button"
                  onClick={logout}
                  className="inline-flex items-center gap-1 font-condensed text-label uppercase text-dim transition-colors duration-state ease-out-expo hover:text-text"
                >
                  <LogOut size={16} strokeWidth={2} aria-hidden="true" />
                  <span className="rail:max-wide:sr-only">Sign out</span>
                </button>
              </div>
            )}
          </>
        }
      />
      <main id="main" className="min-w-0 flex-1">
        {children}
      </main>
    </div>
  );
}
