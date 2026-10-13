"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Ava, Icon, Sheet } from "@/components/ui";
import { api, type ChatFull } from "@/lib/api";
import { rub } from "@/lib/format";
import { dealChip } from "@/lib/labels";
import { useSession, usePoll } from "@/lib/session";

export default function ChatPage() {
  const { id } = useParams<{ id: string }>();
  const { user, toast } = useSession();
  const { data: c, error, reload } = usePoll(() => api<ChatFull>(`/chats/${id}`), [id], 8000);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [task, setTask] = useState(false);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const count = c?.messages.length ?? 0;
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [count]);

  if (error && !c) return <div className="page"><Link href="/chats" className="btn ghost sm"><Icon name="back" size={18} /> Чаты</Link><div className="note bad">{error}</div></div>;
  if (!c || !user) return <div className="page"><div className="skeleton" /></div>;

  async function send() {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    try {
      await api(`/chats/${id}/messages`, { method: "POST", body: { text: t } });
      setText("");
      await reload();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  }

  async function register() {
    setBusy(true);
    try {
      const r = await api<{ dealId: string }>(`/chats/${id}/task`, { method: "POST", body: { title: title.trim(), description: desc.trim() || undefined } });
      setTask(false);
      setTitle("");
      setDesc("");
      toast("Задача зарегистрирована");
      window.location.assign(`/deals/${r.dealId}`);
    } catch (e) {
      toast((e as Error).message, "err");
      setBusy(false);
    }
  }

  const isExec = c.role === "executor";
  return (
    <div className="page chat">
      <div className="row">
        <Link href="/chats" className="iconbtn" aria-label="Назад"><Icon name="back" size={18} /></Link>
        <Ava name={c.with.name} src={c.with.avatar} size="sm" />
        <div className="grow" style={{ minWidth: 0 }}>
          <b className="ellipsis" style={{ display: "block" }}>{c.with.name}</b>
          <Link href={`/services/${c.service.id}`} className="small muted ellipsis" style={{ display: "block" }}>{c.service.title}</Link>
        </div>
      </div>

      {c.deals.map((d) => {
        const chip = dealChip(d);
        return (
          <Link key={d.id} href={`/deals/${d.id}`} className="card tap row">
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="small muted">Задача</div>
              <b className="ellipsis" style={{ display: "block" }}>{d.title}</b>
              {d.target > 0 && <div className="small muted">{rub(d.target)}</div>}
            </div>
            <span className={`chip ${chip.tone}`}>{chip.text}</span>
          </Link>
        );
      })}

      <div className="bubbles">
        {c.messages.length === 0 && <div className="empty" style={{ padding: 16 }}>Напишите первое сообщение</div>}
        {c.messages.map((m) =>
          m.kind === "system" ? (
            <div key={m.id} className="sysmsg">
              {m.text}
              {m.dealId && <Link href={`/deals/${m.dealId}`}> Открыть задачу</Link>}
            </div>
          ) : (
            <div key={m.id} className={`bubble ${m.by === user.id ? "me" : ""}`}>{m.text}</div>
          ),
        )}
        <div ref={end} />
      </div>

      {isExec && (
        <button className="btn soft" onClick={() => setTask(true)}>Зарегистрировать задачу</button>
      )}
      <div className="composer">
        <input className="input" placeholder="Сообщение" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void send()} />
        <button className="sendbtn" disabled={busy || !text.trim()} onClick={send} aria-label="Отправить"><Icon name="arrow" size={20} /></button>
      </div>

      {task && (
        <Sheet onClose={() => setTask(false)}>
          <h2 style={{ fontSize: 22, textAlign: "left" }}>Новая задача</h2>
          <p className="sub" style={{ margin: "4px 0 14px" }}>Заказчик увидит ее со статусом «Согласование». Дальше вы разобьете работу на этапы и отправите условия.</p>
          <div className="stack">
            <input className="input" autoFocus placeholder="Название задачи" value={title} onChange={(e) => setTitle(e.target.value)} />
            <textarea className="input" placeholder="О чем договорились (необязательно)" value={desc} onChange={(e) => setDesc(e.target.value)} />
            <button className="btn" disabled={busy || title.trim().length < 3} onClick={register}>Зарегистрировать</button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
