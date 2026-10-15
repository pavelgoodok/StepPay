"use client";
import Link from "next/link";
import { useState } from "react";
import { Bell } from "@/components/bell";
import { DealCard } from "@/components/deal-card";
import { Ava, IMG, Icon, Logo, Money } from "@/components/ui";
import { api, type DealSummary } from "@/lib/api";
import { rub } from "@/lib/format";
import { useSession, usePoll } from "@/lib/session";

export default function Deals() {
  const { user, wallet } = useSession();
  const [filter, setFilter] = useState<"open" | "done" | "all">("open");
  const [pick, setPick] = useState<"payer" | "exec" | null>(null);
  const { data, error } = usePoll(() => api<DealSummary[]>("/deals"), []);
  const pending = usePoll(() => api<{ dealId: string; title: string; target: { name: string } }[]>("/reviews/pending"), [user?.id]);
  if (!user) return null;

  // исполнителю не нужен выбор роли: переключатель показывается, только если сделки есть и в той и в другой роли
  const isExecKind = user.role === "executor" || user.kind === "executor";
  const execCount = (data ?? []).filter((d) => d.executorId === user.id).length;
  const payerCount = (data ?? []).filter((d) => d.executorId !== user.id).length;
  const both = execCount > 0 && payerCount > 0;
  const view: "payer" | "exec" = both ? pick ?? (isExecKind ? "exec" : "payer") : execCount > 0 ? "exec" : payerCount > 0 ? "payer" : isExecKind ? "exec" : "payer";
  const byRole = (data ?? []).filter((d) => (view === "exec" ? d.executorId === user.id : d.executorId !== user.id));
  const isDone = (d: DealSummary) => d.status === "completed" || d.status === "cancelled";
  const mine = byRole.filter((d) => (filter === "all" ? true : filter === "done" ? isDone(d) : !isDone(d)));
  type Need = { d: DealSummary; title: string; sub: string; chip: string };
  const needs: Need[] = [];
  for (const d of data ?? []) {
    const stage = d.currentStage;
    if (d.status === "draft" && d.executorId === user.id) needs.push({ d, title: "Составьте этапы", sub: d.title, chip: "Согласовать" });
    else if (d.status === "funding" && d.signatures && d.signatures.required.includes(user.id) && !d.signatures.signed.includes(user.id) && (d.ownerId !== user.id || d.raised >= d.target)) needs.push({ d, title: "Подпишите контракт", sub: d.title, chip: "Подписать" });
    else if (d.status === "funding" && d.mode === "own" && d.ownerId === user.id) needs.push({ d, title: "Условия готовы", sub: `${d.title} · ${rub(d.target)}`, chip: "Проверить" });
    else if (stage?.status === "submitted" && (d.ownerId === user.id || (d.mode === "crowdfunding" && d.executorId !== user.id))) needs.push({ d, title: `${d.executor.name} сдал(а) этап`, sub: `«${stage.title}» · ${d.title}`, chip: "Проверить" });
    else if (stage?.status === "disputed" && user.role === "arbiter") needs.push({ d, title: "Нужно решение по спору", sub: `«${stage.title}» · ${d.title}`, chip: "Открыть" });
  }

  return (
    <div className="page">
      <div className="top">
        <Logo />
        <div className="actions">
          <Bell />
          <Link href="/profile"><Ava name={user.name} src={user.avatar} /></Link>
        </div>
      </div>

      <Link href="/wallet" className="hero bg-reserve plain" aria-label="Открыть кошелек">
        {isExecKind ? (
          <>
            <div className="label">Баланс</div>
            <div className="big"><Money value={wallet?.free ?? 0} /></div>
            <div className="small" style={{ opacity: 0.85 }}>Выплаты за принятые этапы · открыть кошелек</div>
          </>
        ) : (
          <>
            <div className="label">Зарезервировано</div>
            <div className="big"><Money value={wallet?.reserved ?? 0} /></div>
            <div className="small" style={{ opacity: 0.85 }}>Свободно {rub(wallet?.free ?? 0)} · открыть кошелек</div>
          </>
        )}
      </Link>

      <div className="qa">
        {isExecKind ? (
          <>
            <Link href="/wallet"><span className="ic"><Icon name="wallet" size={22} /></span>Кошелек</Link>
            <Link href="/services/new"><span className="ic"><Icon name="plus" size={22} /></span>Услуга</Link>
          </>
        ) : (
          <>
            <Link href="/wallet"><span className="ic"><Icon name="plus" size={22} /></span>Пополнить</Link>
            <Link href="/catalog"><span className="ic"><Icon name="sprout" size={22} /></span>Каталог</Link>
          </>
        )}
        <Link href="/chats"><span className="ic"><Icon name="chat" size={22} /></span>Чаты</Link>
        <Link href="/receipts"><span className="ic"><Icon name="check" size={22} /></span>Чеки</Link>
      </div>

      {(pending.data ?? []).map((p) => (
        <Link key={p.dealId} href={`/deals/${p.dealId}`} className="card tap row" style={{ background: "var(--amber-soft)" }}>
          <Icon name="star" size={26} />
          <div className="grow">
            <div className="title">Оцените работу: {p.target.name}</div>
            <div className="sub ellipsis">{p.title}</div>
          </div>
          <span className="chip amber">Оценить</span>
        </Link>
      ))}

      {needs.map((n) => (
        <Link key={n.d.id} href={`/deals/${n.d.id}`} className="card tap row" style={{ background: "var(--amber-soft)" }}>
          <Icon name="clock" size={26} />
          <div className="grow">
            <div className="title">{n.title}</div>
            <div className="sub ellipsis">{n.sub}</div>
          </div>
          <span className="chip amber">{n.chip}</span>
        </Link>
      ))}

      {both && (
        <div className="seg">
          <button className={view === "payer" ? "on" : ""} onClick={() => setPick("payer")}>Я заказчик</button>
          <button className={view === "exec" ? "on" : ""} onClick={() => setPick("exec")}>Я исполнитель</button>
        </div>
      )}

      <div className="sec"><h2>Мои сделки</h2></div>
      <div className="chips">
        {([["open", "В работе"], ["done", "Завершены"], ["all", "Все"]] as const).map(([k, t]) => (
          <button key={k} className={`opt ${filter === k ? "on" : ""}`} onClick={() => setFilter(k)}>{t}</button>
        ))}
      </div>
      {error && <div className="note bad">{error}</div>}
      {!data && <div className="skeleton" />}
      {data && mine.length === 0 && (
        <div className="empty">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={IMG.folder} alt="" />
          <p style={{ marginTop: 8 }}>{filter === "done" ? "Завершенных сделок пока нет" : view === "exec" ? "Сделок пока нет. Заказчики найдут вас через каталог услуг" : "Выберите исполнителя в каталоге услуг"}</p>
          {view !== "exec" && filter !== "done" && <Link href="/catalog" className="btn soft sm" style={{ marginTop: 12 }}>В каталог</Link>}
          {view === "exec" && filter !== "done" && <Link href="/services/new" className="btn soft sm" style={{ marginTop: 12 }}>Добавить услугу</Link>}
        </div>
      )}
      <div className="grid2">
        {mine.map((d) => (
          <DealCard key={d.id} d={d} who={view === "exec" ? (d.owner ?? { id: "crowd", name: "Спонсоры" }) : d.executor} />
        ))}
      </div>
    </div>
  );
}
