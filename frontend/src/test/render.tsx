import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthContext, type AuthUser } from '../hooks/useAuth';

export const ADMIN: AuthUser = {
  id: 'u-admin', email: 'fixture-admin@leadforge.test', full_name: 'Fixture Admin', role: 'admin', is_active: true,
};
export const VIEWER: AuthUser = {
  id: 'u-viewer', email: 'fixture-viewer@leadforge.test', full_name: 'Fixture Viewer', role: 'viewer', is_active: true,
};

interface Options {
  route?: string;
  /** The route pattern the screen is mounted at, so useParams works: '/leads/:id'. */
  path?: string;
  user?: AuthUser;
}

/** Renders a screen the way the app does: signed in, inside the router, with a fresh query cache. */
export function renderWithProviders(ui: ReactElement, { route = '/', path = '*', user = ADMIN }: Options = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const auth = {
    user, accessToken: 'fixture-token', isLoading: false, isAuthenticated: true, isAdmin: user.role === 'admin',
    login: async () => {}, logout: async () => {},
  };
  const result = render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path={path} element={ui} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}
