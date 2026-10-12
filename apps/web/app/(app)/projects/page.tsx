"use client";
import Link from "next/link";
import { useState } from "react";
import { IMG, Icon, Logo, StageBars } from "@/components/ui";
import { api, type DealSummary } from "@/lib/api";
import { rub } from "@/lib/format";
import { dealChip, nameOf } from "@/lib/labels";
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
          <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.1 }}>{crowd ? "Поддерживайте без риска" : "Гранты с прозрачной отчётностью"}</div>
          <p className="small" style={{ margin: "8px 0 0", opacity: 0.92 }}>
            {crowd ? "Автор получает деньги только за выполненные этапы. Сорвался этап — остаток вернётся вам." : "Деньги выдаются по этапам. Каждый перевод подтверждается результатом работ."}
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
      {data?.map((d) => {
        const chip = dealChip(d);
        const pct = d.target ? Math.min(100, Math.round((d.raised / d.target) * 100)) : 0;
        return (
          <Link key={d.id} href={`/deals/${d.id}`} className={`card tap dealcard ${chip.tone}`}>
            <div className="row between">
              <div className="grow">
                <div className="title ellipsis">{d.title}</div>
                <div className="sub ellipsis">{nameOf(users, crowd ? d.executorId : d.ownerId)}</div>
              </div>
              <span className={`chip ${chip.tone}`}>{chip.text}</span>
            </div>
            <div className="row between" style={{ marginTop: 10 }}>
              <b className="mono">{crowd ? `${rub(d.raised)} из ${rub(d.target)}` : `до ${rub(d.target)}`}</b>
              {crowd && <span className="muted small">{pct}%</span>}
            </div>
            {crowd && <div className="meter" style={{ marginTop: 6 }}><b style={{ width: `${pct}%` }} /></div>}
            <StageBars done={d.stages.done} total={d.stages.total} working={d.status === "active"} />
            <div className="row between small muted">
              <span>Этап {Math.min(d.stages.done + 1, d.stages.total)} из {d.stages.total}</span>
              {crowd && <span><Icon name="crowd" size={14} /> {d.sponsors} спонсоров</span>}
            </div>
          </Link>
        );
      })}
      </div>
    </div>
  );
}
