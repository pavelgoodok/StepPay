"use client";
import Link from "next/link";
import { useState } from "react";
import { DealCard } from "@/components/deal-card";
import { IMG, Icon, Initials, Logo, Money } from "@/components/ui";
import { api, type DealSummary } from "@/lib/api";
import { rub } from "@/lib/format";
import { nameOf } from "@/lib/labels";
import { useSession, usePoll } from "@/lib/session";

export default function Deals() {
  const { user, wallet, users } = useSession();
  const [view, setView] = useState<"payer" | "exec">(user?.role === "executor" ? "exec" : "payer");
  const { data, error } = usePoll(() => api<DealSummary[]>("/deals"), []);
  if (!user) return null;

  const mine = (data ?? []).filter((d) => (view === "exec" ? d.executorId === user.id : d.executorId !== user.id));
  const needs = (data ?? []).filter(
    (d) =>
      (d.currentStage?.status === "submitted" && (d.ownerId === user.id || (d.mode === "crowdfunding" && d.executorId !== user.id))) ||
      (d.currentStage?.status === "disputed" && user.role === "arbiter"),
  );

  return (
    <div className="page">
      <div className="top">
        <Logo />
        <Link href="/profile"><Initials name={user.name} /></Link>
      </div>

      <div className="hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="art" src={IMG.card} alt="" />
        <div className="label">Цифровой рубль · свободно</div>
        <div className="big"><Money value={wallet?.free ?? 0} /></div>
        <span className="pill"><Icon name="lock" size={15} /> {rub(wallet?.reserved ?? 0)} в резерве</span>
      </div>

      <div className="qa">
        <Link href="/wallet"><span className="ic"><Icon name="plus" size={22} /></span>Пополнить</Link>
        <button onClick={() => window.dispatchEvent(new Event("steppay:create"))}><span className="ic"><Icon name="hammer" size={22} /></span>Сделка</button>
        <Link href="/projects"><span className="ic"><Icon name="sprout" size={22} /></span>Проекты</Link>
        <Link href="/receipts"><span className="ic"><Icon name="check" size={22} /></span>Чеки</Link>
      </div>

      <div className="stats">
        <div className="stat"><span className="eyebrow">В работе</span><b>{(data ?? []).filter((d) => d.status === "active").length}</b></div>
        <div className="stat"><span className="eyebrow">Ждут решения</span><b>{needs.length}</b></div>
        <div className="stat"><span className="eyebrow">Завершено</span><b>{(data ?? []).filter((d) => d.status === "completed").length}</b></div>
      </div>

      {needs.map((d) => (
        <Link key={d.id} href={`/deals/${d.id}`} className="card tap row" style={{ background: "var(--amber-soft)" }}>
          <Icon name="clock" size={26} />
          <div className="grow">
            <div className="title">{d.currentStage?.status === "disputed" ? "Нужно решение по спору" : `${nameOf(users, d.executorId)} сдал(а) этап`}</div>
            <div className="sub ellipsis">«{d.currentStage?.title}» · {d.title}</div>
          </div>
          <span className="chip amber">Проверить</span>
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
          <p style={{ marginTop: 8 }}>{view === "exec" ? "Пока нет сделок, где вы исполнитель" : "Создайте первую сделку кнопкой «+»"}</p>
        </div>
      )}
      <div className="grid2">
        {mine.map((d) => (
          <DealCard key={d.id} d={d} who={view === "exec" ? nameOf(users, d.ownerId ?? "Спонсоры") : nameOf(users, d.executorId)} />
        ))}
      </div>
    </div>
  );
}
