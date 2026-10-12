"use client";
import Link from "next/link";
import type { DealSummary, Person } from "@/lib/api";
import { rub } from "@/lib/format";
import { dealChip } from "@/lib/labels";
import { Ava, Icon, StageDots } from "./ui";

/** Карточка сделки или проекта: кто, сколько, на каком этапе. Без декоративных полос, статус в тексте. */
export function DealCard({ d, who, crowd }: { d: DealSummary; who: Person; crowd?: boolean }) {
  const chip = dealChip(d);
  const pct = d.target ? Math.min(100, Math.round(((crowd ? d.raised : (d.stages.done / d.stages.total) * d.target) / d.target) * 100)) : 0;
  return (
    <Link href={`/deals/${d.id}`} className="card tap dcard">
      <div className="dc-top">
        <Ava name={who.name} src={who.avatar} size="sm" />
        <div className="grow">
          <div className="dc-title ellipsis">{d.title}</div>
          <div className="sub ellipsis">{who.name}</div>
        </div>
        <span className={`chip ${chip.tone}`}>{chip.text}</span>
      </div>
      <div>
        <div className="dc-money">
          <b className="mono">{rub(crowd ? d.raised : d.target)}</b>
          <span>{crowd ? `из ${rub(d.target)}` : "сумма сделки"}</span>
        </div>
        <div className="meter" style={{ marginTop: 10 }}><b style={{ width: `${pct}%` }} /></div>
      </div>
      <div className="dc-foot">
        <StageDots done={d.stages.done} total={d.stages.total} working={d.status === "active"} />
        {crowd ? (
          <span className="row" style={{ gap: 6 }}><Icon name="crowd" size={16} /> {d.sponsors}</span>
        ) : (
          <span>{pct}% выплачено</span>
        )}
      </div>
    </Link>
  );
}
