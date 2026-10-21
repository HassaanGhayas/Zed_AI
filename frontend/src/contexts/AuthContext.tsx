import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { setAuthToken, setTokenRefresher } from '../lib/api';
import { setCloudUser, syncOnLogin, flushSessionSync } from '../lib/cloudSync';

interface AuthContextValue {
  /** False when Supabase env vars are unset: callers should render no auth UI. */
  enabled: boolean;
  user: User | null;
  session: Session | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const DISABLED: AuthContextValue = {
  enabled: false,
  user: null,
  session: null,
  loading: false,
  signInWithGoogle: async () => {},
  signOut: async () => {},
};

const AuthContext = createContext<AuthContextValue>(DISABLED);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(supabase !== null);

  useEffect(() => {
    if (!supabase) return;
    let alive = true;

    const apply = (next: Session | null) => {
      setSession(next);
      setAuthToken(next?.access_token ?? null);
      setCloudUser(next?.user.id ?? null);
    };

    // A 401 on an analytics call (stale token right after load) refreshes once and retries.
    setTokenRefresher(async () => {
      const { data } = await supabase!.auth.refreshSession();
      return data.session?.access_token ?? null;
    });

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!alive) return;
        apply(data.session);
        if (data.session) void syncOnLogin(data.session.user.id);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (!alive) return;
      apply(next);
      if (event === 'SIGNED_IN' && next) void syncOnLogin(next.user.id);
    });

    // Debounced progress would be lost on tab close/background: flush it.
    const flushNow = () => {
      void flushSessionSync();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushNow();
    };
    window.addEventListener('pagehide', flushNow);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      alive = false;
      setTokenRefresher(null);
      sub.subscription.unsubscribe();
      window.removeEventListener('pagehide', flushNow);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (!supabase) return;
    try {
      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
    } catch {
      // Sign-in is optional; the app keeps working locally.
    }
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    // Push pending progress while the token is still valid. Local data is kept.
    try {
      await flushSessionSync();
    } catch {
      // ignore
    }
    try {
      await supabase.auth.signOut();
    } catch {
      // ignore
    }
    setSession(null);
    setAuthToken(null);
    setCloudUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () =>
      supabase
        ? { enabled: true, user: session?.user ?? null, session, loading, signInWithGoogle, signOut }
        : DISABLED,
    [session, loading, signInWithGoogle, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = (): AuthContextValue => useContext(AuthContext);
