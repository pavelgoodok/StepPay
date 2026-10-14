"use client";
import { Tick } from "@/components/motion";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { API_URL, api, getToken, setToken, type PublicUser, type Wallet } from "./api";
import { rub } from "./format";

interface Session {
  user: PublicUser | null;
  wallet: Wallet | null;
  /** возможности сервера: пополнение без оплаты есть только в демо */
  features: { topup: boolean; chain?: boolean };
  users: PublicUser[];
  ready: boolean;
  refresh(): Promise<void>;
  login(userId: string): Promise<void>;
  /** вход по готовому токену (после подтверждения телефона) */
  completeLogin(token: string): Promise<void>;
  logout(): void;
  toast(text: string, tone?: "ok" | "err"): void;
  /** администратор в сессии без passkey: доступно только управление ключами */
  adminLocked: boolean;
}

/** Шина обновлений: SSE-сигнал «сделка изменилась» будит экраны, которые показывают данные. */
const listeners = new Set<() => void>();
const onChanged = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};

const Ctx = createContext<Session | null>(null);
export const useSession = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("SessionProvider отсутствует");
  return c;
};

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [features, setFeatures] = useState({ topup: true });
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [ready, setReady] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; text: string; tone: "ok" | "err" }[]>([]);
  const [adminLocked, setAdminLocked] = useState(false);
  const lastFree = useRef<number | null>(null);

  const toast = useCallback((text: string, tone: "ok" | "err" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);

  const refresh = useCallback(async () => {
    if (!getToken()) return;
    try {
      const me = await api<{ user: PublicUser; wallet: Wallet; features?: { topup: boolean; chain?: boolean }; adminLocked?: boolean }>("/me");
      setAdminLocked(!!me.adminLocked);
      setUser(me.user);
      if (me.features) setFeatures(me.features);
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
    }, 20_000);
    return () => clearInterval(t);
  }, [refresh]);

  // живые обновления: сервер сам сообщает об изменениях; опрос остается запасным
  const uid = user?.id;
  useEffect(() => {
    if (!uid || typeof EventSource === "undefined") return;
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    // в адресе запроса идет билет на 2 минуты, а не постоянный токен: при обрыве берем новый
    const connect = async () => {
      try {
        const { ticket } = await api<{ ticket: string }>("/auth/ticket", { method: "POST", body: {} });
        if (stopped) return;
        es = new EventSource(`${API_URL}/events?ticket=${encodeURIComponent(ticket)}`);
        es.addEventListener("changed", () => {
          void refresh();
          listeners.forEach((cb) => cb());
        });
        es.addEventListener("notify", (e) => {
          const { text } = JSON.parse((e as MessageEvent).data) as { text: string };
          toast(text);
          try {
            if (document.visibilityState === "hidden" && "Notification" in window && Notification.permission === "granted") new Notification("StepPay", { body: text, icon: "/logo.png" });
          } catch {
            /* уведомления недоступны - остается тост */
          }
        });
        es.onerror = () => {
          es?.close();
          if (!stopped) timer = setTimeout(() => void connect(), 3000);
        };
      } catch {
        if (!stopped) timer = setTimeout(() => void connect(), 8000);
      }
    };
    void connect();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      es?.close();
    };
  }, [uid, refresh, toast]);

  const login = useCallback(
    async (userId: string) => {
      const r = await api<{ token: string }>("/auth/demo", { method: "POST", body: { userId } });
      setToken(r.token);
      lastFree.current = null;
      await refresh();
    },
    [refresh],
  );

  const completeLogin = useCallback(
    async (token: string) => {
      setToken(token);
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
    <Ctx.Provider value={{ user, wallet, features, users, ready, refresh, login, completeLogin, logout, toast, adminLocked }}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            {t.tone === "ok" && <span className="tick"><Tick /></span>}
            <span>{t.text}</span>
            <i className="life" />
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

/** Периодическое обновление данных экрана («живая» картина без перезагрузки). */
export function usePoll<T>(fn: () => Promise<T>, deps: unknown[], ms = 15_000) {
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
    const off = onChanged(() => void run());
    return () => {
      clearInterval(t);
      off();
    };
  }, [run, ms]);
  return { data, error, reload: run };
}
