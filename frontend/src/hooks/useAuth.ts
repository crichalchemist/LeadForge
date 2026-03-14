import { createContext, useContext } from 'react';

export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  role: 'admin' | 'viewer';
  is_active: boolean;
}

export interface AuthContextType {
  user: AuthUser | null;
  accessToken: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType>({
  user: null,
  accessToken: null,
  isLoading: true,
  isAuthenticated: false,
  isAdmin: false,
  login: async () => {},
  logout: async () => {},
});

export function useAuth(): AuthContextType {
  return useContext(AuthContext);
}
