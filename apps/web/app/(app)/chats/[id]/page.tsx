"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ReviewCard } from "@/components/review-card";
import { Ava, Icon, MoneyInput, Sheet } from "@/components/ui";
import { api, type ChatFull } from "@/lib/api";
import { rub, toKopecks } from "@/lib/format";
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
  const [sum, setSum] = useState("");
  const [arbiters, setArbiters] = useState<{ id: string; name: string; resolved: number }[] | null>(null);
  const [arb, setArb] = useState("");
  const [backup, setBackup] = useState<string | null>(null);
  useEffect(() => {
    if (!task) return;
    void api<{ id: string; name: string; resolved: number }[]>("/arbiters").then((l) => {
      setArbiters(l);
      setArb((cur) => cur || l[0]?.id || "");
      setBackup((cur) => (cur === null ? (l[1]?.id ?? "") : cur));
    }).catch(() => setArbiters([]));
  }, [task]);

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
      const r = await api<{ dealId: string }>(`/chats/${id}/task`, { method: "POST", body: { title: title.trim(), amount: toKopecks(Number(sum)), description: desc.trim() || undefined, arbiterId: arb || undefined, backupArbiterId: backup ?? undefined } });
      setTask(false);
      setTitle("");
      setDesc("");
      setSum("");
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
              {(d.target > 0 || d.agreed) && <div className="small muted">{rub(d.target > 0 ? d.target : (d.agreed ?? 0))}</div>}
            </div>
            <span className={`chip ${chip.tone}`}>{chip.text}</span>
          </Link>
        );
      })}

      <ReviewCard dealId={id} collapsible />

      {!isExec && c.deals.length === 0 && (
        <div className="note">Обсудите задачу и сумму. Когда договоритесь, исполнитель зарегистрирует задачу, и вы увидите ее здесь и в разделе «Сделки».</div>
      )}

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

      <div className="composer-wrap">
      {isExec && (
        <button className="btn soft" onClick={() => setTask(true)}>Зарегистрировать задачу</button>
      )}
      <div className="composer">
        <input className="input" placeholder="Сообщение" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void send()} />
        <button className="sendbtn" disabled={busy || !text.trim()} onClick={send} aria-label="Отправить"><Icon name="arrow" size={20} /></button>
      </div>
      </div>

      {task && (
        <Sheet onClose={() => setTask(false)}>
          <h2 style={{ fontSize: 22, textAlign: "left" }}>Новая задача</h2>
          <p className="sub" style={{ margin: "4px 0 14px" }}>Заказчик увидит ее со статусом «Согласование». Дальше вы разобьете работу на этапы и отправите условия.</p>
          <div className="stack">
            <input className="input" autoFocus placeholder="Название задачи" value={title} onChange={(e) => setTitle(e.target.value)} />
            <MoneyInput placeholder="Сумма, на которую договорились, ₽" value={sum} onChange={setSum} />
            <textarea className="input" placeholder="О чем договорились (необязательно)" value={desc} onChange={(e) => setDesc(e.target.value)} />
            {(arbiters ?? []).length > 0 && (
              <>
                <div className="field">
                  <label>Приемщик спора</label>
                  <div className="chips">
                    {(arbiters ?? []).map((a) => <button key={a.id} className={`opt ${arb === a.id ? "on" : ""}`} onClick={() => { setArb(a.id); if (backup === a.id) setBackup(""); }}>{a.name}<span className="small" style={{ opacity: 0.7 }}> · решил {a.resolved}</span></button>)}
                  </div>
                </div>
                <div className="field">
                  <label>Запасной приемщик</label>
                  <div className="chips">
                    <button className={`opt ${backup === "" ? "on" : ""}`} onClick={() => setBackup("")}>Без запасного</button>
                    {(arbiters ?? []).filter((a) => a.id !== arb).map((a) => <button key={a.id} className={`opt ${backup === a.id ? "on" : ""}`} onClick={() => setBackup(a.id)}>{a.name}</button>)}
                  </div>
                  <span className="small muted">Запасной решает спор, если основной молчит половину срока.</span>
                </div>
              </>
            )}
            <button className="btn" disabled={busy || title.trim().length < 3 || !Number(sum)} onClick={register}>Зарегистрировать</button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
