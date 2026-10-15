"use client";
import Link from "next/link";
import type { DealSummary, Person } from "@/lib/api";
import { rub } from "@/lib/format";
import { dealChip } from "@/lib/labels";
import { useChangeFlash } from "./motion";
import { Ava, Icon, SegBar } from "./ui";

/** Карточка сделки или проекта: кто, сколько, на каком этапе. Без декоративных полос, статус в тексте. */
export function DealCard({ d, who, crowd, role }: { d: DealSummary; who: Person; crowd?: boolean; role?: string }) {
  const chip = dealChip(d);
  const total = d.stages.total;
  const funding = d.status === "funding" && crowd;
  const flash = useChangeFlash(`${d.status}|${d.stages.done}|${d.raised}|${d.target}`);
  const filled = funding ? (d.target ? (d.raised / d.target) * total : 0) : d.stages.done;
  return (
    <Link href={`/deals/${d.id}`} className={`card tap dcard ${flash ? "flash" : ""}`}>
      <div className="dc-top">
        <Ava name={who.name} src={who.avatar} size="sm" />
        <div className="grow">
          <div className="dc-title ellipsis">{d.title}</div>
          <div className="sub ellipsis">{role ? `${role} · ` : ""}{who.name}</div>
        </div>
        <span className={`chip ${chip.tone}`}>{chip.text}</span>
      </div>
      <div className="dc-money">
        <b className="mono">{rub(crowd ? d.raised : d.target)}</b>
        <span>{crowd ? `из ${rub(d.target)}` : "сумма сделки"}</span>
      </div>
      <SegBar count={total} filled={filled} cur={d.status === "active" ? d.stages.done : undefined} label={funding ? "Сбор средств по этапам" : "Принятые этапы"} />
      {crowd && (
        <div className="dc-foot">
          <span className="row" style={{ gap: 6 }}><Icon name="crowd" size={16} /> {d.sponsors}</span>
        </div>
      )}
    </Link>
  );
}
