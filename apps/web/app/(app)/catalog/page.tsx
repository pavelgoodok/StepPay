"use client";
import { useState } from "react";
import { ProjectCard, ServiceCard } from "@/components/cards";
import { IMG, Logo } from "@/components/ui";
import { api, type ProjectItem, type ServiceItem } from "@/lib/api";
import { usePoll } from "@/lib/session";

const SERVICE_CATS = ["Ремонт и строительство", "Разработка и дизайн", "Мероприятия", "Обучение", "Красота и здоровье", "Другое"];

export default function Catalog() {
  const [tab, setTab] = useState<"projects" | "services">("projects");
  const [kind, setKind] = useState<"" | "crowdfunding" | "grant">("");
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");
  const qs = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...extra, q: q.trim() })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `?${s}` : "";
  };
  const projects = usePoll(() => (tab === "projects" ? api<ProjectItem[]>(`/projects${qs({ kind, category: cat })}`) : Promise.resolve([] as ProjectItem[])), [tab, kind, cat, q]);
  const services = usePoll(() => (tab === "services" ? api<ServiceItem[]>(`/services${qs({ category: cat })}`) : Promise.resolve([] as ServiceItem[])), [tab, cat, q]);
  const list = tab === "projects" ? projects.data : services.data;

  return (
    <div className="page">
      <div className="top"><Logo /></div>
      <h1 className="h1">Каталог</h1>
      <div className="seg">
        <button className={tab === "projects" ? "on" : ""} onClick={() => { setTab("projects"); setCat(""); }}>Проекты</button>
        <button className={tab === "services" ? "on" : ""} onClick={() => { setTab("services"); setCat(""); }}>Услуги</button>
      </div>
      <input className="input" placeholder="Поиск" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="chips">
        {tab === "projects" ? (
          <>
            <button className={`opt ${kind === "" ? "on" : ""}`} onClick={() => setKind("")}>Все</button>
            <button className={`opt ${kind === "crowdfunding" ? "on" : ""}`} onClick={() => setKind("crowdfunding")}>Краудфандинг</button>
            <button className={`opt ${kind === "grant" ? "on" : ""}`} onClick={() => setKind("grant")}>Гранты</button>
          </>
        ) : (
          <>
            <button className={`opt ${cat === "" ? "on" : ""}`} onClick={() => setCat("")}>Все</button>
            {SERVICE_CATS.map((c) => <button key={c} className={`opt ${cat === c ? "on" : ""}`} onClick={() => setCat(c)}>{c}</button>)}
          </>
        )}
      </div>
      {!list && <div className="skeleton" />}
      {list && list.length === 0 && (
        <div className="empty">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={IMG.folder} alt="" />
          <p style={{ marginTop: 8 }}>Результатов нет</p>
        </div>
      )}
      <div className="grid2">
        {tab === "projects"
          ? projects.data?.map((p) => <ProjectCard key={p.id} p={p} />)
          : services.data?.map((s) => <ServiceCard key={s.id} s={s} />)}
      </div>
    </div>
  );
}
