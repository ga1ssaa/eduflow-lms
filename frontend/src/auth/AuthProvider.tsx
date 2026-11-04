import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
} from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { sessionClient } from '../lib/client';
import type { SessionSnapshot } from '../lib/client';
import type { LoginInput, RegisterInput } from '../lib/types';

interface AuthContextValue extends SessionSnapshot {
  login(input: LoginInput): Promise<void>;
  register(input: RegisterInput): Promise<void>;
  logout(): Promise<void>;
  retry(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const snapshot = useSyncExternalStore(
    sessionClient.subscribe,
    sessionClient.getSnapshot,
    sessionClient.getSnapshot,
  );

  useEffect(() => {
    let epoch = sessionClient.getSnapshot().epoch;
    return sessionClient.subscribe(() => {
      const next = sessionClient.getSnapshot().epoch;
      if (next !== epoch) {
        epoch = next;
        void queryClient.cancelQueries();
        queryClient.clear();
      }
    });
  }, [queryClient]);

  useEffect(() => {
    void sessionClient.bootstrap();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        ...snapshot,
        login: sessionClient.login,
        register: sessionClient.register,
        logout: sessionClient.logout,
        retry: sessionClient.retry,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth must be used within AuthProvider');
  return auth;
}
