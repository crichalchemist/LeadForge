import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { fetchMe, loginUser, logoutUser, refreshToken, setAccessToken } from '../../api/client';
import { AuthContext, type AuthUser } from '../../hooks/useAuth';

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessTokenState, setAccessTokenState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Try to restore session from refresh cookie on mount
  useEffect(() => {
    refreshToken()
      .then((token) => {
        setAccessToken(token);
        setAccessTokenState(token);
        // Through the client, so the call reaches the Worker in production (VITE_API_BASE_URL) and in
        // development alike; a bare fetch('/api/…') only ever worked behind the Vite proxy.
        return fetchMe();
      })
      .then((userData: AuthUser) => {
        setUser(userData);
      })
      .catch(() => {
        setAccessToken(null);
        setAccessTokenState(null);
        setUser(null);
      })
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await loginUser(email, password);
    setAccessToken(data.access_token);
    setAccessTokenState(data.access_token);
    setUser(data.user);
  }, []);

  const logout = useCallback(async () => {
    await logoutUser();
    setAccessToken(null);
    setAccessTokenState(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        accessToken: accessTokenState,
        isLoading,
        isAuthenticated: !!user,
        isAdmin: user?.role === 'admin',
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
