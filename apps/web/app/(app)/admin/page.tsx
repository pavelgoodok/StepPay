"use client";
import Link from "next/link";
import { useState } from "react";
import { Ava, Logo } from "@/components/ui";
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
  const { user, toast } = useSession();
  const [tab, setTab] = useState<Tab>("review");
  const [phone, setPhone] = useState("");
  const sum = usePoll(() => api<Record<Tab | "services", number>>("/admin/summary"), []);
  const list = usePoll(() => api<ProjectItem[]>(`/admin/projects?status=${tab}`), [tab]);
  const grantors = usePoll(() => api<Person[]>("/admin/grantors"), []);

  if (!user) return null;
  if (user.role !== "admin") return <div className="page"><div className="note bad">Раздел только для администраторов</div></div>;

  async function setGrantor(value: boolean, p = phone) {
    try {
      await api("/admin/grantors", { method: "POST", body: { phone: p, value } });
      setPhone("");
      toast(value ? "Грантодатель добавлен" : "Грантодатель удален");
      await grantors.reload();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  }

  return (
    <div className="page">
      <div className="top"><Logo /></div>
      <h1 className="h1">Проверка проектов</h1>
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

      <div className="sec"><h2>Грантодатели</h2></div>
      <div className="card stack">
        <div className="sub">Только они могут финансировать гранты. Укажите номер телефона зарегистрированного пользователя.</div>
        {grantors.data?.map((g) => (
          <div key={g.id} className="row">
            <Ava name={g.name} src={g.avatar} size="sm" />
            <b className="grow ellipsis">{g.name}</b>
          </div>
        ))}
        <div className="row">
          <input className="input" inputMode="tel" placeholder="+7 900 000 00 00" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <button className="btn sm" style={{ whiteSpace: "nowrap" }} disabled={phone.replace(/\D/g, "").length < 10} onClick={() => setGrantor(true)}>Добавить</button>
        </div>
      </div>
    </div>
  );
}
