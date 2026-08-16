import React, { createContext, useContext } from 'react';
import { useAuthState, AuthState, AuthEvent } from './useAuthState';
import type { ServerCapabilities } from '../api/auth';
import type { User } from '../types';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  authState: AuthState;
  authEvents: AuthEvent[];
  /** What the configured server supports, or null when none is configured. */
  capabilities: ServerCapabilities | null;
  clearAuthEvents: () => void;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName?: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  authState: 'initializing',
  authEvents: [],
  capabilities: null,
  clearAuthEvents: () => {},
  signIn: async () => {},
  signUp: async () => {},
  requestPasswordReset: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const state = useAuthState();

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

export function useUser() {
  return useContext(AuthContext).user;
}
