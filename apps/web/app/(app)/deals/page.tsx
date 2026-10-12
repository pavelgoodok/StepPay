"use client";
import Link from "next/link";
import { useState } from "react";
import { DealCard } from "@/components/deal-card";
import { Ava, IMG, Icon, Logo, Money } from "@/components/ui";
import { api, type DealSummary } from "@/lib/api";
import { rub } from "@/lib/format";
import { useSession, usePoll } from "@/lib/session";

export default function Deals() {
  const { user, wallet } = useSession();
  const [view, setView] = useState<"payer" | "exec">(user?.role === "executor" ? "exec" : "payer");
  const { data, error } = usePoll(() => api<DealSummary[]>("/deals"), []);
  if (!user) return null;

  const mine = (data ?? []).filter((d) => (view === "exec" ? d.executorId === user.id : d.executorId !== user.id));
  type Need = { d: DealSummary; title: string; sub: string; chip: string };
  const needs: Need[] = [];
  for (const d of data ?? []) {
    const stage = d.currentStage;
    if (d.status === "draft" && d.executorId === user.id) needs.push({ d, title: "Составьте этапы", sub: d.title, chip: "Согласовать" });
    else if (d.status === "funding" && d.mode === "own" && d.ownerId === user.id) needs.push({ d, title: "Условия готовы", sub: `${d.title} · ${rub(d.target)}`, chip: "Проверить" });
    else if (stage?.status === "submitted" && (d.ownerId === user.id || (d.mode === "crowdfunding" && d.executorId !== user.id))) needs.push({ d, title: `${d.executor.name} сдал(а) этап`, sub: `«${stage.title}» · ${d.title}`, chip: "Проверить" });
    else if (stage?.status === "disputed" && user.role === "arbiter") needs.push({ d, title: "Нужно решение по спору", sub: `«${stage.title}» · ${d.title}`, chip: "Открыть" });
  }

  return (
    <div className="page">
      <div className="top">
        <Logo />
        <Link href="/profile"><Ava name={user.name} src={user.avatar} /></Link>
      </div>

      <div className="hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="art" src={IMG.card} alt="" />
        <div className="label">Свободно</div>
        <div className="big"><Money value={wallet?.free ?? 0} /></div>
        <span className="pill"><Icon name="lock" size={15} /> {rub(wallet?.reserved ?? 0)} в резерве</span>
      </div>

      <div className="qa">
        <Link href="/wallet"><span className="ic"><Icon name="plus" size={22} /></span>Пополнить</Link>
        <Link href="/catalog"><span className="ic"><Icon name="sprout" size={22} /></span>Каталог</Link>
        <Link href="/chats"><span className="ic"><Icon name="chat" size={22} /></span>Чаты</Link>
        <Link href="/receipts"><span className="ic"><Icon name="check" size={22} /></span>Чеки</Link>
      </div>

      <div className="stats">
        <div className="stat"><span className="eyebrow">В работе</span><b>{(data ?? []).filter((d) => d.status === "active").length}</b></div>
        <div className="stat"><span className="eyebrow">Ждут вас</span><b>{needs.length}</b></div>
        <div className="stat"><span className="eyebrow">Завершено</span><b>{(data ?? []).filter((d) => d.status === "completed").length}</b></div>
      </div>

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

      <div className="seg">
        <button className={view === "payer" ? "on" : ""} onClick={() => setView("payer")}>Я заказчик</button>
        <button className={view === "exec" ? "on" : ""} onClick={() => setView("exec")}>Я исполнитель</button>
      </div>

      <div className="sec"><h2>Мои сделки</h2></div>
      {error && <div className="note bad">{error}</div>}
      {!data && <div className="skeleton" />}
      {data && mine.length === 0 && (
        <div className="empty">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={IMG.receipt} alt="" />
          <p style={{ marginTop: 8 }}>{view === "exec" ? "Сделок, где вы исполнитель, пока нет" : "Выберите исполнителя в каталоге услуг"}</p>
          {view !== "exec" && <Link href="/catalog" className="btn soft sm" style={{ marginTop: 12 }}>В каталог</Link>}
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
