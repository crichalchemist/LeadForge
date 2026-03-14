import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: '□' },
  { to: '/pipeline', label: 'Pipeline', icon: '▦' },
  { to: '/leads', label: 'Leads', icon: '◎' },
  { to: '/reports', label: 'Reports', icon: '▤' },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-56 bg-gray-900 text-gray-300 flex flex-col">
        <div className="px-4 py-5 border-b border-gray-700">
          <h1 className="text-lg font-bold text-white tracking-tight">LeadForge</h1>
          <p className="text-xs text-gray-500 mt-0.5">CRM Dashboard</p>
        </div>
        <nav className="flex-1 px-2 py-4 space-y-1">
          {NAV_ITEMS.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-gray-800 text-white'
                    : 'hover:bg-gray-800 hover:text-white'
                }`
              }
            >
              <span className="text-base">{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
