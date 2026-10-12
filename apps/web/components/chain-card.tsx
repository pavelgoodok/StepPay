"use client";
import { useState } from "react";
import type { DealFull } from "@/lib/api";
import { Icon, Sheet } from "./ui";

const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-6)}`;
const when = (ts: number) => new Date(ts * 1000).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Прогон сделки на контракте в тестовой сети: адреса и транзакции, которые можно открыть в обозревателе. */
export function ChainCard({ d }: { d: DealFull }) {
  const [open, setOpen] = useState(false);
  const c = d.chain;
  if (!c) return null;
  const tx = (h: string) => (c.explorer ? `${c.explorer}/tx/${h}` : undefined);
  return (
    <>
      <button className="card tap row" style={{ textAlign: "left", width: "100%" }} onClick={() => setOpen(true)}>
        <span className="setic"><Icon name="swap" size={20} /></span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="title">Тестовая сеть</div>
          <div className="small muted ellipsis">{c.network}</div>
        </div>
        <span className="chip">{c.txs.length} транзакций</span>
      </button>

      {open && (
        <Sheet onClose={() => setOpen(false)}>
          <h2 style={{ fontSize: 22, textAlign: "left" }}>Сделка на контракте</h2>
          <div className="stack" style={{ marginTop: 14 }}>
            <div className="sub">Эта сделка проведена на смарт-контракте StepEscrow в сети {c.network}. Токены тестовые, стоимости не имеют и заменяют цифровой рубль.</div>
            <div className="note" style={{ marginTop: 0 }}>
              <div className="small muted">Контракт, сделка №{c.dealId}</div>
              {c.explorer ? (
                <a className="mono small" style={{ wordBreak: "break-all", color: "var(--blue)" }} href={`${c.explorer}/address/${c.contract}`} target="_blank" rel="noreferrer">{c.contract}</a>
              ) : (
                <div className="mono small" style={{ wordBreak: "break-all" }}>{c.contract}</div>
              )}
            </div>
            <div className="jlist">
              {c.txs.map((t) => (
                <div key={t.hash} className="jitem">
                  <div className="row between"><b>{t.label}</b><span className="small muted" style={{ whiteSpace: "nowrap" }}>{when(t.at)}</span></div>
                  {tx(t.hash) ? (
                    <a className="small mono" style={{ color: "var(--blue)" }} href={tx(t.hash)} target="_blank" rel="noreferrer">{short(t.hash)}</a>
                  ) : (
                    <span className="small muted mono">{short(t.hash)}</span>
                  )}
                </div>
              ))}
            </div>
            {!c.explorer && <div className="small muted">Сеть локальная, обозревателя у нее нет: хеши можно сверить в логе узла.</div>}
          </div>
        </Sheet>
      )}
    </>
  );
}
