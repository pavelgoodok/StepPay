"use client";
import Link from "next/link";
import { Ava, IMG, Logo } from "@/components/ui";
import { api, type ChatItem } from "@/lib/api";
import { usePoll } from "@/lib/session";

const when = (ts: number) => {
  const d = new Date(ts);
  const same = d.toDateString() === new Date().toDateString();
  return same ? d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
};

export default function Chats() {
  const { data } = usePoll(() => api<ChatItem[]>("/chats"), []);
  return (
    <div className="page">
      <div className="top"><Logo /></div>
      <h1 className="h1">Чаты</h1>
      {!data && <div className="skeleton" />}
      {data && data.length === 0 && (
        <div className="empty">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={IMG.chat} alt="" />
          <p style={{ marginTop: 8 }}>Чатов нет. Для начала переписки откройте услугу в каталоге</p>
          <Link href="/catalog" className="btn soft sm" style={{ marginTop: 12 }}>В каталог</Link>
        </div>
      )}
      <div className="stack">
        {data?.map((c) => (
          <Link key={c.id} href={`/chats/${c.id}`} className="card tap row">
            <Ava name={c.with.name} src={c.with.avatar} />
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="row between">
                <b className="ellipsis">{c.with.name}</b>
                {c.last && <span className="small muted">{when(c.last.at)}</span>}
              </div>
              <div className="small muted ellipsis">{c.service.title}</div>
              <div className="sub ellipsis">{c.last ? c.last.text : "Пока без сообщений"}</div>
            </div>
            {c.unread > 0 && <span className="badge">{c.unread}</span>}
          </Link>
        ))}
      </div>
    </div>
  );
}
