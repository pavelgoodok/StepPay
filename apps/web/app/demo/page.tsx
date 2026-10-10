"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { IMG, Icon, Logo } from "@/components/ui";
import { api } from "@/lib/api";
import { nameOf } from "@/lib/labels";
import { useSession } from "@/lib/session";

interface Narration {
  step: number;
  total: number;
  title: string;
  text: string;
  viewAs: string;
  path: string;
}
const KEY = "steppay.demo";

export default function Demo() {
  const { users, login, toast } = useSession();
  const router = useRouter();
  const [script, setScript] = useState<string[]>([]);
  const [done, setDone] = useState(0);
  const [last, setLast] = useState<Narration | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<string[]>("/demo/script").then(setScript).catch((e: Error) => toast(e.message, "err"));
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as { done: number; last: Narration | null } | null;
      if (saved) {
        setDone(saved.done);
        setLast(saved.last);
      }
    } catch {
      /* первый запуск */
    }
  }, [toast]);

  const save = (d: number, l: Narration | null) => {
    setDone(d);
    setLast(l);
    try { localStorage.setItem(KEY, JSON.stringify({ done: d, last: l })); } catch { /* ignore */ }
  };

  async function next() {
    setBusy(true);
    try {
      const n = await api<Narration>("/demo/step", { method: "POST", body: { step: done + 1 } });
      save(done + 1, n);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    try {
      await api("/demo/reset", { method: "POST" });
      save(0, null);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  }

  async function view(n: Narration) {
    await login(n.viewAs);
    router.push(n.path);
  }

  const finished = script.length > 0 && done >= script.length;

  return (
    <div className="shell">
      <div className="page">
        <div className="top">
          <Logo />
          <Link href="/login" className="chip">Вход</Link>
        </div>
        <div className="hero">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="art" src={IMG.terminal} alt="" />
          <div style={{ maxWidth: 220 }}>
            <div className="label">Демо для жюри · 3 минуты</div>
            <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.1, marginTop: 6 }}>Деньги уходят, когда есть результат</div>
          </div>
        </div>

        {last && (
          <div className="card stack" style={{ gap: 8, border: "2px solid var(--blue)" }}>
            <span className="chip" style={{ alignSelf: "flex-start" }}>Шаг {last.step} из {last.total}</span>
            <div className="title">{last.title}</div>
            <div className="sub">{last.text}</div>
            <button className="btn soft" onClick={() => view(last)}>Посмотреть глазами: {nameOf(users, last.viewAs)} <Icon name="arrow" size={18} /></button>
          </div>
        )}

        {finished ? (
          <div className="card stack" style={{ textAlign: "center" }}>
            <div className="title">Сценарий завершён</div>
            <div className="sub">Один движок: ремонт, краудфандинг и грант. Деньги ушли за принятый этап и вернулись за проваленный.</div>
          </div>
        ) : (
          <button className="btn" disabled={busy || script.length === 0} onClick={next}>
            {busy ? <span className="spin" /> : <>Шаг {done + 1}: {script[done] ?? "…"}</>}
          </button>
        )}

        <div className="card stack" style={{ gap: 10 }}>
          {script.map((s, i) => (
            <div key={i} className="row" style={{ opacity: i < done ? 1 : i === done ? 1 : 0.55 }}>
              <div className="avatar" style={{ width: 30, height: 30, fontSize: 13, background: i < done ? "linear-gradient(135deg,#0fae68,#2bd48a)" : i === done ? undefined : "var(--line)", color: i > done ? "var(--muted)" : "#fff" }}>
                {i < done ? <Icon name="check" size={16} /> : i + 1}
              </div>
              <div className="grow" style={{ fontWeight: i === done ? 700 : 500 }}>{s}</div>
            </div>
          ))}
        </div>

        <button className="btn ghost" disabled={busy} onClick={reset}>Сбросить данные и начать заново</button>
        <p className="small muted">Все участники — демо-пользователи, деньги — эмуляция кошелька цифрового рубля.</p>
      </div>
    </div>
  );
}
