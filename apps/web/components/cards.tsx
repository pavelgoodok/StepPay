"use client";
import Link from "next/link";
import type { ProjectItem, ServiceItem } from "@/lib/api";
import { photoSrc } from "@/lib/api";
import { rub } from "@/lib/format";
import { KIND_LABEL, PROJECT_STATUS } from "@/lib/labels";
import { Ava, Icon, SegBar } from "./ui";

const CAT_ICON: Record<string, string> = { "Игры": "bolt", "Музыка и творчество": "ring", "Технологии": "laptop", "Образование": "award", "Городская среда": "sprout", "Социальные проекты": "crowd" };
const catTone = (c: string) => [...c].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 4;

/** Обложка проекта; без фото показывается плоская плашка с иконкой категории. */
export function Cover({ url, category }: { url?: string; category: string }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="cover" src={photoSrc(url)} alt="" />;
  }
  return <div className={`cover none tone${catTone(category)}`}><Icon name={CAT_ICON[category] ?? "flag"} size={44} /></div>;
}

export function ProjectCard({ p, href, showStatus }: { p: ProjectItem; href?: string; showStatus?: boolean }) {
  const st = p.status ? PROJECT_STATUS[p.status] : null;
  return (
    <Link href={href ?? `/projects/${p.id}`} className="card tap lcard">
      <Cover url={p.cover} category={p.category} />
      <div className="pc-body">
        <div className="row between">
          <span className="small muted">{KIND_LABEL[p.kind]} · {p.category}</span>
          {showStatus && st && <span className={`chip ${st.tone}`}>{st.text}</span>}
        </div>
        <div className="dc-title">{p.title}</div>
        {p.summary && <div className="sub clamp2">{p.summary}</div>}
        {p.kind === "crowdfunding" && p.dealId ? (
          <div>
            <div className="dc-money"><b className="mono">{rub(p.raised)}</b><span>из {rub(p.goal)}</span></div>
            <div style={{ marginTop: 8 }}><SegBar count={p.stageCount} filled={p.goal ? (p.raised / p.goal) * p.stageCount : 0} label="Сбор средств по этапам" /></div>
          </div>
        ) : (
          <div className="dc-money"><b className="mono">{rub(p.goal)}</b><span>{p.kind === "grant" ? (p.dealId ? "грант выдан" : "ищет финансирование") : "цель"}</span></div>
        )}
        <div className="row" style={{ gap: 8 }}>
          <Ava name={p.owner.name} src={p.owner.avatar} size="sm" />
          <span className="sub ellipsis">{p.owner.name}</span>
        </div>
      </div>
    </Link>
  );
}

export function ServiceCard({ s, href }: { s: ServiceItem; href?: string }) {
  return (
    <Link href={href ?? `/services/${s.id}`} className="card tap lcard">
      {s.photos[0] && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="cover" src={photoSrc(s.photos[0])} alt="" />
      )}
      <div className="pc-body">
        <div className="row between">
          <span className="small muted">{s.category}</span>
          {!s.active && <span className="chip gray">Скрыта</span>}
        </div>
        <div className="dc-title">{s.title}</div>
        <div className="sub clamp2">{s.description}</div>
        <div className="row between">
          <div className="row" style={{ gap: 8, minWidth: 0 }}>
            <Ava name={s.owner.name} src={s.owner.avatar} size="sm" />
            <span className="sub ellipsis">{s.owner.name}</span>
          </div>
          {s.priceFrom ? <b className="mono" style={{ whiteSpace: "nowrap" }}>от {rub(s.priceFrom)}</b> : null}
        </div>
      </div>
    </Link>
  );
}
