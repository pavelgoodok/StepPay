"use client";
import Link from "next/link";
import { useState } from "react";
import { DealCard } from "@/components/deal-card";
import { IMG, Logo } from "@/components/ui";
import { api, type DealSummary } from "@/lib/api";
import { nameOf } from "@/lib/labels";
import { useSession, usePoll } from "@/lib/session";

export default function Projects() {
  const { users } = useSession();
  const [tab, setTab] = useState<"crowdfunding" | "grant">("crowdfunding");
  const { data } = usePoll(() => api<DealSummary[]>(`/projects?mode=${tab}`), [tab]);
  const crowd = tab === "crowdfunding";

  return (
    <div className="page">
      <div className="top"><Logo /></div>
      <h1 className="h1">Проекты</h1>
      <div className="seg">
        <button className={crowd ? "on" : ""} onClick={() => setTab("crowdfunding")}>Краудфандинг</button>
        <button className={!crowd ? "on" : ""} onClick={() => setTab("grant")}>Гранты</button>
      </div>

      <div className="hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="art" src={crowd ? IMG.safe : IMG.terminal} alt="" />
        <div style={{ maxWidth: 210 }}>
          <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.1 }}>{crowd ? "Поддерживайте без риска" : "Гранты с прозрачной отчетностью"}</div>
          <p className="small" style={{ margin: "8px 0 0", opacity: 0.92 }}>
            {crowd ? "Автор получает деньги только за выполненные этапы. Сорвался этап - остаток вернется вам." : "Деньги выдаются по этапам. Каждый перевод подтверждается результатом работ."}
          </p>
        </div>
      </div>

      <h2 className="title">{crowd ? "Популярное" : "Актуальные программы"}</h2>
      {!data && <div className="skeleton" />}
      {data && data.length === 0 && (
        <div className="empty">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={IMG.receipt} alt="" />
          <p style={{ marginTop: 8 }}>Пока пусто. Создайте {crowd ? "сбор" : "программу"} кнопкой «+»</p>
        </div>
      )}
      <div className="grid2">
        {data?.map((d) => (
          <DealCard key={d.id} d={d} crowd={crowd} who={nameOf(users, crowd ? d.executorId : d.ownerId)} />
        ))}
      </div>
    </div>
  );
}
