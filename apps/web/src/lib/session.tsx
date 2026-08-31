"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "./api/client.ts";
import { isApiError } from "./api/errors.ts";
import type { UserDto } from "./api/types.ts";

/**
 * ADR 0009: Supabase Auth's refresh-token lifetime is the only authority on
 * whether a session is live, and it is thirty days for every role. Nothing here
 * decides expiry — the browser holds a token, the API decides whether it is
 * still one, and a rejected token clears the session.
 */

const STORAGE_KEY = "tor-now.session";

type SessionState = {
  readonly token: string | null;
  readonly user: UserDto | null;
  readonly loading: boolean;
  readonly signIn: (token: string, user: UserDto) => void;
  readonly signOut: () => void;
  readonly refresh: () => Promise<void>;
};

const SessionContext = createContext<SessionState | null>(null);

const readToken = (): string | null => {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

const writeToken = (token: string | null): void => {
  try {
    if (token === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Without storage the session lasts one page; sign-in still works.
  }
};

export const SessionProvider = ({ children }: { children: ReactNode }) => {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<UserDto | null>(null);
  const [loading, setLoading] = useState(true);

  const signOut = useCallback(() => {
    writeToken(null);
    setToken(null);
    setUser(null);
  }, []);

  const signIn = useCallback((nextToken: string, nextUser: UserDto) => {
    writeToken(nextToken);
    setToken(nextToken);
    setUser(nextUser);
  }, []);

  // A stored token is a claim, not a session. It is exchanged for the User the
  // API says it belongs to, and dropped if the API disagrees.
  const restore = useCallback(async () => {
    const stored = readToken();
    if (stored === null) {
      setLoading(false);
      return;
    }
    try {
      const me = await api.me(stored);
      setToken(stored);
      setUser(me);
    } catch (error) {
      if (isApiError(error) && error.code === "NETWORK") {
        // Offline is not the same as signed out; keep the token and let the
        // next call decide.
        setToken(stored);
      } else {
        writeToken(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void restore();
  }, [restore]);

  const refresh = useCallback(async () => {
    if (token === null) return;
    try {
      setUser(await api.me(token));
    } catch (error) {
      if (isApiError(error) && error.code === "UNAUTHENTICATED") signOut();
    }
  }, [token, signOut]);

  const value = useMemo<SessionState>(
    () => ({ token, user, loading, signIn, signOut, refresh }),
    [token, user, loading, signIn, signOut, refresh],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
};

export const useSession = (): SessionState => {
  const state = useContext(SessionContext);
  if (state === null) {
    throw new Error("useSession must be used inside a SessionProvider");
  }
  return state;
};
