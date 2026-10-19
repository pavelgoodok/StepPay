"use client";
import Link from "next/link";
import { useState } from "react";
import { Empty, PageHead, Tabs } from "@/components/admin";
import { Ava } from "@/components/ui";
import { dateTime, RESOLVED_BY, type AdminDispute } from "@/lib/admin";
import { api } from "@/lib/api";
import { rub, timeLeft } from "@/lib/format";
import { usePoll } from "@/lib/session";

export default function Disputes() {
  const [tab, setTab] = useState<"open" | "resolved">("open");
  const { data } = usePoll(() => api<AdminDispute[]>(`/admin/disputes?status=${tab}`), [tab], 20_000);
  const now = Date.now();
  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead title="Споры" sub="Спор решает независимый приемщик из реестра. Если срок истекает без решения, деньги возвращаются заказчику" />
      <Tabs value={tab} onChange={setTab} items={[{ id: "open", label: "Открытые", count: tab === "open" ? data?.length : undefined }, { id: "resolved", label: "Решенные" }]} />
      {!data && <div className="skeleton" />}
      {data?.length === 0 && <Empty text={tab === "open" ? "Открытых споров нет" : "Решенных споров пока нет"} />}
      {data && data.length > 0 && (
        <div className="card adm-tablewrap">
          <table className="adm-table">
            <thead><tr><th>Сделка и этап</th><th>Стороны</th><th>Приемщик</th><th className="r">Сумма</th><th>{tab === "open" ? "Срок" : "Решение"}</th></tr></thead>
            <tbody>
              {data.map((x) => {
                const left = x.deadline ? x.deadline - now : undefined;
                return (
                  <tr key={`${x.dealId}-${x.stageId}`}>
                    <td style={{ maxWidth: 320 }}>
                      <Link href={`/deals/${x.dealId}`} className="adm-a"><b>{x.dealTitle}</b></Link>
                      <div className="small muted">{x.stageTitle}</div>
                      {x.reason && <div className="small" style={{ marginTop: 4 }}>Причина: {x.reason}</div>}
                    </td>
                    <td>
                      <div className="row" style={{ gap: 8 }}><Ava name={x.executor.name} src={x.executor.avatar} size="sm" /><span className="small">{x.executor.name}<br /><span className="muted">исполнитель</span></span></div>
                      {x.owner && <div className="row" style={{ gap: 8, marginTop: 6 }}><Ava name={x.owner.name} src={x.owner.avatar} size="sm" /><span className="small">{x.owner.name}<br /><span className="muted">заказчик</span></span></div>}
                    </td>
                    <td>{x.arbiter ? x.arbiter.name : <span className="chip amber">Не назначен</span>}<div className="small muted">сообщений в споре: {x.messages}</div></td>
                    <td className="r mono">{rub(x.amount)}</td>
                    <td>
                      {tab === "open" ? (
                        <>
                          {x.openedAt && <div className="small muted">Открыт {dateTime(x.openedAt)}</div>}
                          {left !== undefined && <span className={`chip ${left < 24 * 3600_000 ? "red" : "amber"}`}>{left > 0 ? `Осталось ${timeLeft(left)}` : "Срок истек"}</span>}
                        </>
                      ) : (
                        <>
                          <span className={`chip ${x.resolution?.decision === "accepted" ? "green" : "amber"}`}>{x.resolution?.decision === "accepted" ? "Выплата исполнителю" : "Возврат заказчику"}</span>
                          <div className="small muted">{x.resolution ? `${RESOLVED_BY[x.resolution.by] ?? x.resolution.by}, ${dateTime(x.resolution.at)}` : ""}</div>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
