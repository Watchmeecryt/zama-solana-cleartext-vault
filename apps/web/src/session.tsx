import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { AppSession } from './wallet/session.js';

type SessionContextValue = {
  session: AppSession | null;
  setSession: (session: AppSession | null) => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { readonly children: ReactNode }) {
  const [session, setSession] = useState<AppSession | null>(null);
  const value = useMemo(() => ({ session, setSession }), [session]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('SessionProvider is missing');
  return value;
}
