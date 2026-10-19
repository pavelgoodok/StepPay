"use client";
import Link from "next/link";
import { Bars, Kpi, PageHead } from "@/components/admin";
import { dateTime, type AdminDashboard } from "@/lib/admin";
import { api } from "@/lib/api";
import { group, rub } from "@/lib/format";
import { LEDGER_LABEL } from "@/lib/labels";
import { usePoll } from "@/lib/session";

export default function AdminHome() {
  const { data: d } = usePoll(() => api<AdminDashboard>("/admin/dashboard"), [], 20_000);
  if (!d) return <div><PageHead title="Показатели" /><div className="skeleton" /></div>;
  const queue = [
    { href: "/admin/disputes", label: "Споры", n: d.queue.disputes, hint: "ждут решения приемщика" },
    { href: "/admin/verifications", label: "Подтверждение данных", n: d.queue.verifications, hint: "заявки компаний и предпринимателей" },
    { href: "/admin/projects", label: "Проекты на проверке", n: d.queue.projects, hint: "ждут решения" },
  ];
  return (
    <div className="stack" style={{ gap: 20 }}>
      <PageHead title="Показатели" sub="Сводка по платформе и очередь задач" />

      <div className="adm-queue">
        {queue.map((q) => (
          <Link key={q.href} href={q.href} className={`adm-q ${q.n > 0 ? "hot" : ""}`}>
            <b>{q.n}</b>
            <div><div style={{ fontWeight: 700 }}>{q.label}</div><div className="small muted">{q.hint}</div></div>
          </Link>
        ))}
      </div>

      <div className="adm-kpis">
        <Kpi label="Участники" value={group(d.users.total)} hint={`${d.users.executors} исполнителей, ${d.users.customers} заказчиков`} />
        <Kpi label="Новые за неделю" value={group(d.users.newWeek)} hint={`подтверждено данных: ${d.users.verified}`} />
        <Kpi label="Сделки в работе" value={group(d.deals.active)} hint={`всего ${d.deals.total}, завершено ${d.deals.completed}`} />
        <Kpi label="Зарезервировано" value={rub(d.money.reserved)} hint="в активных сделках" />
        <Kpi label="Выплачено исполнителям" value={rub(d.money.paid)} hint={`возвращено ${rub(d.money.refunded)}`} tone="green" />
        <Kpi label="Споры" value={group(d.deals.disputed)} hint={`отменено сделок: ${d.deals.cancelled}`} tone={d.deals.disputed > 0 ? "red" : undefined} />
      </div>

      <div className="adm-cols">
        <div className="card stack">
          <h2 className="title">Движение средств за 14 дней</h2>
          <Bars series={d.series} />
        </div>
        <div className="card stack">
          <div className="row between"><h2 className="title">Последние операции</h2><Link href="/admin/transactions" className="small" style={{ color: "var(--blue)", fontWeight: 600 }}>Все</Link></div>
          {d.recent.length === 0 && <div className="sub">Операций пока нет</div>}
          {d.recent.map((r) => (
            <div key={r.id} className="adm-line">
              <div style={{ minWidth: 0 }}>
                <b className="ellipsis" style={{ display: "block" }}>{LEDGER_LABEL[r.type] ?? r.type}</b>
                <span className="small muted ellipsis" style={{ display: "block" }}>{r.user}{r.dealTitle ? ` · ${r.dealTitle}` : ""} · {dateTime(r.at)}</span>
              </div>
              <b className="mono">{rub(r.amount)}</b>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
