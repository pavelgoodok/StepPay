"use client";
import Link from "next/link";
import { useState } from "react";
import { PageHead } from "@/components/admin";
import { Ava } from "@/components/ui";
import { api, type Person, type ProjectItem } from "@/lib/api";
import { dayLabel, rub } from "@/lib/format";
import { KIND_LABEL } from "@/lib/labels";
import { useSession, usePoll } from "@/lib/session";

type Tab = "review" | "changes" | "approved" | "rejected";
const TABS: { id: Tab; label: string }[] = [
  { id: "review", label: "На проверке" },
  { id: "changes", label: "Доработка" },
  { id: "approved", label: "Опубликованы" },
  { id: "rejected", label: "Отклонены" },
];

export default function Admin() {
  const { user } = useSession();
  const [tab, setTab] = useState<Tab>("review");
  const sum = usePoll(() => api<Record<Tab | "services", number>>("/admin/summary"), []);
  const list = usePoll(() => api<ProjectItem[]>(`/admin/projects?status=${tab}`), [tab]);

  if (!user) return null;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead title="Проекты" sub="Проверка проектов перед публикацией" />
      <div className="stats">
        {TABS.slice(0, 3).map((t) => (
          <div key={t.id} className="stat"><span className="eyebrow">{t.label}</span><b>{sum.data?.[t.id] ?? 0}</b></div>
        ))}
      </div>
      <div className="chips">
        {TABS.map((t) => <button key={t.id} className={`opt ${tab === t.id ? "on" : ""}`} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>
      {!list.data && <div className="skeleton" />}
      {list.data?.length === 0 && <div className="empty"><p>Здесь пусто</p></div>}
      <div className="stack">
        {list.data?.map((p) => (
          <Link key={p.id} href={`/projects/${p.id}`} className="card tap row">
            <Ava name={p.owner.name} src={p.owner.avatar} />
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="small muted">{KIND_LABEL[p.kind]} · {p.category}</div>
              <b className="ellipsis" style={{ display: "block" }}>{p.title}</b>
              <div className="sub ellipsis">{p.owner.name}{p.submittedAt ? ` · ${dayLabel(p.submittedAt)}` : ""}</div>
            </div>
            <b className="mono" style={{ whiteSpace: "nowrap" }}>{rub(p.goal)}</b>
          </Link>
        ))}
      </div>

    </div>
  );
}
