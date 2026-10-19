"use client";
import type { ReactNode } from "react";
import { rub } from "@/lib/format";

export function PageHead({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="adm-head">
      <div>
        <h1 className="h1">{title}</h1>
        {sub && <p className="sub" style={{ marginTop: 4 }}>{sub}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: string; count?: number }[] }) {
  return (
    <div className="chips">
      {items.map((t) => (
        <button key={t.id} className={`opt ${value === t.id ? "on" : ""}`} onClick={() => onChange(t.id)}>
          {t.label}
          {t.count !== undefined && t.count > 0 ? ` · ${t.count}` : ""}
        </button>
      ))}
    </div>
  );
}

export function Kpi({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "red" | "amber" | "green" }) {
  return (
    <div className={`adm-kpi ${tone ?? ""}`}>
      <span className="eyebrow">{label}</span>
      <b>{value}</b>
      {hint && <span className="small muted">{hint}</span>}
    </div>
  );
}

/** Столбцы за 14 дней: пополнения и выплаты рядом. Высота считается от наибольшего значения. */
export function Bars({ series }: { series: { day: string; topup: number; payout: number }[] }) {
  const max = Math.max(1, ...series.flatMap((s) => [s.topup, s.payout]));
  return (
    <div>
      <div className="adm-bars" role="img" aria-label="Пополнения и выплаты за 14 дней">
        {series.map((s) => (
          <div key={s.day} className="adm-bar" title={`${s.day}: пополнения ${rub(s.topup)}, выплаты ${rub(s.payout)}`}>
            <div className="pair">
              <i className="a" style={{ height: `${Math.round((s.topup / max) * 100)}%` }} />
              <i className="b" style={{ height: `${Math.round((s.payout / max) * 100)}%` }} />
            </div>
            <span>{s.day.slice(8)}</span>
          </div>
        ))}
      </div>
      <div className="row small muted" style={{ gap: 18, marginTop: 8 }}>
        <span className="row" style={{ gap: 6 }}><i className="adm-dot a" />Пополнения</span>
        <span className="row" style={{ gap: 6 }}><i className="adm-dot b" />Выплаты</span>
      </div>
    </div>
  );
}

export const Empty = ({ text }: { text: string }) => <div className="empty"><p>{text}</p></div>;
