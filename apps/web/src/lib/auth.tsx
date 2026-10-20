import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { supabase } from './supabase';
import type { Me, Session } from './types';

interface AuthState {
  ready: boolean;
  me: Me | null;
  login: (identifier: string, password: string) => Promise<Me>;
  register: (body: Record<string, unknown>) => Promise<{ purchaseId: string; profile: Me }>;
  logout: () => Promise<void>;
  refresh: () => Promise<unknown>;
}

const Ctx = createContext<AuthState | null>(null);

async function adopt(session: Session) {
  const { error } = await supabase.auth.setSession({ access_token: session.accessToken, refresh_token: session.refreshToken });
  if (error) throw new ApiError(error.message, 401);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setHasSession(!!data.session));
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setHasSession(!!session);
      if (event === 'SIGNED_OUT') qc.clear();
    });
    return () => data.subscription.unsubscribe();
  }, [qc]);

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<Me>('/auth/me'),
    enabled: hasSession === true,
    retry: false,
    staleTime: 60_000,
  });

  // Session exists but the API rejects it (deleted user, revoked token) → sign out locally.
  useEffect(() => {
    if (meQuery.error instanceof ApiError && meQuery.error.status === 401) void supabase.auth.signOut();
  }, [meQuery.error]);

  const value: AuthState = {
    ready: hasSession === false || (hasSession === true && !meQuery.isLoading),
    me: hasSession ? (meQuery.data ?? null) : null,
    async login(identifier, password) {
      const res = await api.post<{ session: Session; profile: Me }>('/auth/login', { identifier, password });
      await adopt(res.session);
      qc.setQueryData(['me'], res.profile);
      return res.profile;
    },
    async register(body) {
      const res = await api.post<{ session: Session; profile: Me; purchaseId: string }>('/auth/register', body);
      await adopt(res.session);
      qc.setQueryData(['me'], res.profile);
      return res;
    },
    async logout() {
      await api.post('/auth/logout').catch(() => undefined);
      await supabase.auth.signOut();
      qc.clear();
    },
    refresh: () => qc.invalidateQueries({ queryKey: ['me'] }),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
