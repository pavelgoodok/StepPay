"use client";
import { useState } from "react";
import { api, type PlanResult } from "@/lib/api";
import { rub, toKopecks } from "@/lib/format";
import { useSession } from "@/lib/session";
import { Icon, MoneyInput } from "./ui";

export interface Row {
  title: string;
  rub: string;
  criteria: string[];
}

export const emptyRow = (): Row => ({ title: "", rub: "", criteria: [] });
export const rowsTotal = (rows: Row[]) => rows.reduce((a, r) => a + (Number(r.rub) || 0), 0);
export const rowsToStages = (rows: Row[]) =>
  rows.filter((r) => r.title.trim() && Number(r.rub) > 0).map((r) => ({ title: r.title.trim(), amount: toKopecks(Number(r.rub)), criteria: r.criteria.map((c) => c.trim()).filter(Boolean) }));
export const stagesToRows = (st: { title: string; amount: number; criteria: string[] }[]): Row[] =>
  st.length ? st.map((s) => ({ title: s.title, rub: String(Math.round(s.amount / 100)), criteria: s.criteria })) : [emptyRow()];

/** Список этапов с суммами и автоподбором по описанию задачи. */
export function StageEditor({ rows, onChange, mode, seedText = "", initialBudget = "" }: { rows: Row[]; onChange(r: Row[]): void; mode: "own" | "crowdfunding" | "grant"; seedText?: string; initialBudget?: string }) {
  const { toast } = useSession();
  const [text, setText] = useState(seedText);
  const [budget, setBudget] = useState(initialBudget);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function plan() {
    setBusy(true);
    setNote(null);
    try {
      const sum = Number(budget) || 0;
      const p = await api<PlanResult>("/ai/plan", { method: "POST", body: { description: text.trim(), mode, total: sum > 0 ? toKopecks(sum) : undefined } });
      let left = sum;
      onChange(
        p.stages.map((st, i) => {
          const part = i === p.stages.length - 1 ? left : Math.round((sum * st.share) / 100);
          left -= part;
          return { title: st.title, rub: sum ? String(part) : "", criteria: st.criteria };
        }),
      );
      if (p.source !== "claude") setNote(p.reason?.text ? `Подобран готовый шаблон. ${p.reason.text}` : "Подобран готовый шаблон");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  }

  const set = (i: number, patch: Partial<Row>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="stack">
      <div className="ai" style={{ padding: 0 }}>
        <textarea className="input" placeholder="Опишите задачу, и мы предложим этапы" value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 72 }} />
        <div className="row">
          <MoneyInput placeholder="Бюджет, ₽" value={budget} onChange={setBudget} />
          <button className="btn soft sm" style={{ whiteSpace: "nowrap" }} disabled={busy || text.trim().length < 5} onClick={plan}>
            {busy ? <span className="spin" /> : "Подобрать этапы"}
          </button>
        </div>
        {note && <div className="small muted">{note}</div>}
      </div>
      {rows.map((r, i) => (
        <div key={i} className="srow">
          <div className="row">
            <input className="input" style={{ flex: 2 }} placeholder={`Этап ${i + 1}`} value={r.title} onChange={(e) => set(i, { title: e.target.value })} />
            <MoneyInput style={{ flex: 1 }} placeholder="₽" value={r.rub} onChange={(v) => set(i, { rub: v })} />
            {rows.length > 1 && (
              <button className="iconbtn" aria-label="Убрать этап" onClick={() => onChange(rows.filter((_, j) => j !== i))}><Icon name="x" size={16} /></button>
            )}
          </div>
          <input className="input sm" placeholder="Критерии готовности этапа" value={r.criteria.join("; ")} onChange={(e) => set(i, { criteria: e.target.value.split(";") })} />
        </div>
      ))}
      <div className="row between">
        <button className="btn soft sm" onClick={() => onChange([...rows, emptyRow()])}>Добавить этап</button>
        <b className="mono">{rub(toKopecks(rowsTotal(rows)))}</b>
      </div>
    </div>
  );
}
