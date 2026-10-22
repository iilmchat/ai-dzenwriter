import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { fetchSession, logout, type SessionState } from '../api/session';

interface SessionValue {
  readonly state: SessionState;
  readonly signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | undefined>(undefined);

// Одна проверка входа на весь интерфейс: шапка, защита маршрутов и экран входа берут состояние отсюда.
export function SessionProvider({ children }: { readonly children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ phase: 'loading' });

  useEffect(() => {
    let active = true;
    fetchSession().then((next) => {
      if (active) {
        setState(next);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const signOut = useCallback(async () => {
    await logout();
    setState({ phase: 'anonymous' });
  }, []);

  const value = useMemo(() => ({ state, signOut }), [state, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error('useSession нужен внутри SessionProvider');
  }
  return value;
}
