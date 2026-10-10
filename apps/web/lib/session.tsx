"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, getToken, setToken, type PublicUser, type Wallet } from "./api";
import { rub } from "./format";

interface Session {
  user: PublicUser | null;
  wallet: Wallet | null;
  users: PublicUser[];
  ready: boolean;
  refresh(): Promise<void>;
  login(userId: string): Promise<void>;
  logout(): void;
  toast(text: string, tone?: "ok" | "err"): void;
}

const Ctx = createContext<Session | null>(null);
export const useSession = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("SessionProvider отсутствует");
  return c;
};

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [ready, setReady] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; text: string; tone: "ok" | "err" }[]>([]);
  const lastFree = useRef<number | null>(null);

  const toast = useCallback((text: string, tone: "ok" | "err" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);

  const refresh = useCallback(async () => {
    if (!getToken()) return;
    try {
      const me = await api<{ user: PublicUser; wallet: Wallet }>("/me");
      setUser(me.user);
      setWallet(me.wallet);
      if (lastFree.current !== null && me.wallet.free > lastFree.current) {
        toast(`Поступило ${rub(me.wallet.free - lastFree.current)}`);
      }
      lastFree.current = me.wallet.free;
    } catch (e) {
      if ((e as { status?: number }).status === 401) {
        setToken(null);
        setUser(null);
        setWallet(null);
      }
    }
  }, [toast]);

  useEffect(() => {
    (async () => {
      api<PublicUser[]>("/auth/demo-users").then(setUsers).catch(() => undefined);
      await refresh();
      setReady(true);
    })();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const login = useCallback(
    async (userId: string) => {
      const r = await api<{ token: string }>("/auth/demo", { method: "POST", body: { userId } });
      setToken(r.token);
      lastFree.current = null;
      await refresh();
    },
    [refresh],
  );

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setWallet(null);
    lastFree.current = null;
  }, []);

  return (
    <Ctx.Provider value={{ user, wallet, users, ready, refresh, login, logout, toast }}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

/** Периодическое обновление данных экрана («живая» картина без перезагрузки). */
export function usePoll<T>(fn: () => Promise<T>, deps: unknown[], ms = 4000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async () => {
    try {
      setData(await fn());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    void run();
    const t = setInterval(() => document.visibilityState === "visible" && void run(), ms);
    return () => clearInterval(t);
  }, [run, ms]);
  return { data, error, reload: run };
}
