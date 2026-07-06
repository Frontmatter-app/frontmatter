import React, { createContext, useContext } from 'react';
import { useAuthState, AuthState, AuthEvent } from './useAuthState';
import type { SavedAccount } from './authStorage';
import type { User } from '../types';

interface AuthContextType {
  user:             User | null;
  loading:          boolean;
  authState:        AuthState;
  savedAccounts:    SavedAccount[];
  authEvents:       AuthEvent[];
  clearAuthEvents:  () => void;
  signInWithGoogle: () => Promise<void>;
  sendMagicLink:    (email: string) => Promise<void>;
  logout:           () => Promise<void>;
  switchAccount:    (uid: string) => Promise<void>;
  logoutAll:        () => Promise<void>;
  removeSavedAccount: (uid: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null, loading: true, authState: 'initializing',
  savedAccounts: [], authEvents: [], clearAuthEvents: () => {},
  signInWithGoogle: async () => {}, sendMagicLink: async () => {},
  logout: async () => {}, switchAccount: async () => {},
  logoutAll: async () => {}, removeSavedAccount: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const state = useAuthState();

  return (
    <AuthContext.Provider value={state}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

export function useUser() {
  return useContext(AuthContext).user;
}
