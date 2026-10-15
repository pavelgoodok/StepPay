"use client";
import Link from "next/link";
import { useState } from "react";
import { Bell } from "@/components/bell";
import { ModeSwitch } from "@/components/mode-switch";
import { DealCard } from "@/components/deal-card";
import { Ava, IMG, Icon, Logo, Money } from "@/components/ui";
import { api, type DealSummary } from "@/lib/api";
import { rub } from "@/lib/format";
import { useSession, usePoll } from "@/lib/session";

export default function Deals() {
  const { user, wallet } = useSession();
  const [filter, setFilter] = useState<"open" | "done" | "all">("open");
  const { data, error } = usePoll(() => api<DealSummary[]>("/deals"), []);
  const pending = usePoll(() => api<{ dealId: string; title: string; target: { name: string } }[]>("/reviews/pending"), [user?.id]);
  if (!user) return null;

  // режим аккаунта определяет, какие сделки и действия показаны: личный (заказчик) или профессиональный (исполнитель)
  const isExecKind = user.kind === "executor";
  const view: "payer" | "exec" = isExecKind ? "exec" : "payer";
  const byRole = (data ?? []).filter((d) => (view === "exec" ? d.executorId === user.id : d.executorId !== user.id));
  const isDone = (d: DealSummary) => d.status === "completed" || d.status === "cancelled";
  // текущие сделки зависят от режима аккаунта, а завершенные видны в обоих режимах: это общая история участника
  const all = data ?? [];
  const openList = byRole.filter((d) => !isDone(d));
  const doneList = all.filter(isDone);
  const openCount = openList.length;
  const doneCount = doneList.length;
  // если текущих сделок нет, а завершенные есть, сразу показываем завершенные
  const shownFilter = filter === "open" && openCount === 0 && doneCount > 0 ? "done" : filter;
  const mine = shownFilter === "done" ? doneList : shownFilter === "all" ? [...openList, ...doneList] : openList;
  const sumReserved = byRole.reduce((a, d) => a + (isDone(d) ? 0 : d.reserved), 0);
  const sumPaid = byRole.reduce((a, d) => a + d.paid, 0);
  type Need = { d: DealSummary; title: string; sub: string; chip: string };
  const needs: Need[] = [];
  for (const d of byRole) {
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
          <ModeSwitch compact />
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

      <div className="tiles">
        <div className="tile"><b>{rub(sumReserved)}</b><span>{isExecKind ? "ожидает выплаты" : "в резерве по сделкам"}</span></div>
        <div className="tile"><b>{rub(sumPaid)}</b><span>{isExecKind ? "получено за этапы" : "выплачено исполнителям"}</span></div>
        <div className="tile"><b>{openCount}</b><span>{isExecKind ? "сделок в работе" : "сделок в работе"}</span></div>
      </div>

      {!isExecKind && (pending.data ?? []).map((p) => (
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


      <div className="sec"><h2>Мои сделки</h2></div>
      <div className="chips">
        {([["open", "В работе", openCount], ["done", "Завершены", doneCount], ["all", "Все", openCount + doneCount]] as const).map(([k, t, n]) => (
          <button key={k} className={`opt ${shownFilter === k ? "on" : ""}`} onClick={() => setFilter(k)}>{t} <span className="opt-n">{n}</span></button>
        ))}
      </div>
      {error && <div className="note bad">{error}</div>}
      {!data && <div className="skeleton" />}
      {data && mine.length === 0 && (
        <div className="empty">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={IMG.folder} alt="" />
          <p style={{ marginTop: 8 }}>{shownFilter === "done" ? "Завершенных сделок пока нет" : view === "exec" ? "Сделок пока нет. Заказчики найдут вас через каталог услуг" : "Выберите исполнителя в каталоге услуг"}</p>
          {view !== "exec" && shownFilter !== "done" && <Link href="/catalog" className="btn soft sm" style={{ marginTop: 12 }}>В каталог</Link>}
          {view === "exec" && shownFilter !== "done" && <Link href="/services/new" className="btn soft sm" style={{ marginTop: 12 }}>Добавить услугу</Link>}
        </div>
      )}
      <div className="grid2">
        {mine.map((d) => (
          <DealCard key={d.id} d={d} role={d.executorId === user.id ? "Заказчик" : "Исполнитель"} who={d.executorId === user.id ? (d.owner ?? { id: "crowd", name: "Спонсоры" }) : d.executor} />
        ))}
      </div>
    </div>
  );
}
