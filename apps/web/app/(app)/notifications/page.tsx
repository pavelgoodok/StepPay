"use client";
import Link from "next/link";
import { useEffect } from "react";
import { Icon } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession, usePoll } from "@/lib/session";

interface Note { id: string; at: number; text: string; dealId: string }

const dayKey = (ts: number) => new Date(ts).toDateString();
function dayTitle(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  const yest = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Сегодня";
  if (d.toDateString() === yest.toDateString()) return "Вчера";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

export default function Notifications() {
  const { user, refresh } = useSession();
  const { data, error } = usePoll(() => api<{ items: Note[]; unread: number }>("/notifications"), [user?.id], 10_000);
  const unreadNow = data?.unread ?? 0;
  // открыть раздел значит прочитать: через секунду счетчик на колокольчике обнуляется
  useEffect(() => {
    if (!data || unreadNow === 0) return;
    const t = setTimeout(() => void api("/notifications/read", { method: "POST", body: {} }).then(refresh).catch(() => undefined), 1200);
    return () => clearTimeout(t);
  }, [data, unreadNow, refresh]);

  if (!user) return null;
  if (!data) return <div className="page">{error ? <div className="note bad">{error}</div> : <div className="skeleton" />}</div>;

  const fresh = new Set<string>();
  const seenAt = data.items.length ? data.items.filter((_, i) => i < data.unread).map((n) => n.id) : [];
  seenAt.forEach((id) => fresh.add(id));
  const groups: { key: string; title: string; items: Note[] }[] = [];
  for (const n of data.items) {
    const k = dayKey(n.at);
    const last = groups[groups.length - 1];
    if (last && last.key === k) last.items.push(n);
    else groups.push({ key: k, title: dayTitle(n.at), items: [n] });
  }

  return (
    <div className="page">
      <h1 className="h1">Уведомления</h1>
      {groups.length === 0 && (
        <div className="card empty">
          <Icon name="bell" size={30} />
          <div className="title" style={{ marginTop: 8 }}>Уведомлений нет</div>
          <div className="sub">Здесь отображаются события по сделкам: приемка этапов, споры, выплаты.</div>
        </div>
      )}
      {groups.map((g) => (
        <div key={g.key} className="stack" style={{ gap: 8 }}>
          <div className="small muted" style={{ fontWeight: 700 }}>{g.title}</div>
          <div className="group">
            {g.items.map((n) => {
              const body = (
                <>
                  <span className={`nd ${fresh.has(n.id) ? "on" : ""}`} aria-hidden />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div>{n.text}</div>
                    <div className="small muted">{new Date(n.at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</div>
                  </div>
                  {n.dealId && <Icon name="arrow" size={18} />}
                </>
              );
              return n.dealId ? <Link key={n.id} href={`/deals/${n.dealId}`} className="card tap row note-row">{body}</Link> : <div key={n.id} className="card row note-row">{body}</div>;
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
