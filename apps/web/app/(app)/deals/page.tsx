"use client";
import Link from "next/link";
import { useState } from "react";
import { IMG, Icon, Initials, Logo, Money, StageBars } from "@/components/ui";
import { api, type DealSummary } from "@/lib/api";
import { rub } from "@/lib/format";
import { dealChip, nameOf } from "@/lib/labels";
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
        <img className="art" src={IMG.wallet} alt="" />
        <div className="label">Кошелёк цифрового рубля</div>
        <div className="big"><Money value={wallet?.free ?? 0} /></div>
        <span className="pill"><Icon name="lock" size={15} /> {rub(wallet?.reserved ?? 0)} в резерве</span>
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

      <div className="row between"><h2 className="title">Мои сделки</h2></div>
      {error && <div className="note bad">{error}</div>}
      {!data && <div className="skeleton" />}
      {data && mine.length === 0 && (
        <div className="empty">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={IMG.receipt} alt="" />
          <p style={{ marginTop: 8 }}>{view === "exec" ? "Пока нет сделок, где вы исполнитель" : "Создайте первую сделку кнопкой «+»"}</p>
        </div>
      )}
      {mine.map((d) => {
        const chip = dealChip(d);
        const other = view === "exec" ? nameOf(users, d.ownerId ?? "Спонсоры") : nameOf(users, d.executorId);
        const paidShare = d.target ? Math.round((d.stages.done / d.stages.total) * 100) : 0;
        return (
          <Link key={d.id} href={`/deals/${d.id}`} className="card tap">
            <div className="row between">
              <div className="grow">
                <div className="title ellipsis">{d.title}</div>
                <div className="sub ellipsis">{other}</div>
              </div>
              <span className={`chip ${chip.tone}`}>{chip.text}</span>
            </div>
            <StageBars done={d.stages.done} total={d.stages.total} working={d.status === "active"} />
            <div className="row between small muted">
              <span>Этап {Math.min(d.stages.done + 1, d.stages.total)} из {d.stages.total}</span>
              <span className="mono">{rub(d.target)} · {paidShare}%</span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
