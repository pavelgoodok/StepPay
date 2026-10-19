"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Empty, PageHead, Tabs } from "@/components/admin";
import { dateTime, type AdminTx } from "@/lib/admin";
import { api } from "@/lib/api";
import { rub } from "@/lib/format";
import { LEDGER_LABEL } from "@/lib/labels";
import { useSession } from "@/lib/session";

type Page = { items: AdminTx[]; next: number | null; count: number; total: number };
const TYPES = [{ id: "", label: "Все" }, ...Object.entries(LEDGER_LABEL).map(([id, label]) => ({ id, label }))];

export default function Transactions() {
  const { toast } = useSession();
  const [type, setType] = useState("");
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<AdminTx[]>([]);
  const [meta, setMeta] = useState<{ next: number | null; count: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);

  const load = useCallback(
    async (before?: number) => {
      setBusy(true);
      try {
        const p = new URLSearchParams({ limit: "50" });
        if (type) p.set("type", type);
        if (q) p.set("q", q);
        if (before) p.set("before", String(before));
        const r = await api<Page>(`/admin/transactions?${p}`);
        setRows((old) => (before ? [...old, ...r.items] : r.items));
        setMeta({ next: r.next, count: r.count, total: r.total });
      } catch (e) {
        toast((e as Error).message, "err");
      } finally {
        setBusy(false);
      }
    },
    [type, q, toast],
  );
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead title="Операции" sub="Все движения средств участников: пополнения, резервы, выплаты и возвраты" />
      <Tabs value={type} onChange={setType} items={TYPES} />
      <input className="input" style={{ maxWidth: 420 }} placeholder="Поиск по участнику, сделке или примечанию" value={text} onChange={(e) => setText(e.target.value)} />
      {meta && <div className="small muted">Найдено операций: {meta.count}, на сумму {rub(meta.total)}</div>}
      {rows.length === 0 && !busy && <Empty text="Операций не найдено" />}
      {rows.length > 0 && (
        <div className="card adm-tablewrap">
          <table className="adm-table">
            <thead><tr><th>Дата</th><th>Операция</th><th>Участник</th><th>Сделка</th><th className="r">Сумма</th></tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td className="muted nowrap">{dateTime(t.at)}</td>
                  <td><span className={`chip ${t.type === "payout" ? "green" : t.type === "refund" ? "amber" : t.type === "fee" ? "gray" : ""}`}>{LEDGER_LABEL[t.type] ?? t.type}</span></td>
                  <td><Link href={`/users/${t.userId}`} className="adm-a">{t.userName}</Link></td>
                  <td>{t.dealId ? <Link href={`/deals/${t.dealId}`} className="adm-a">{t.dealTitle ?? t.dealId}</Link> : <span className="muted">-</span>}{t.note && <div className="small muted">{t.note}</div>}</td>
                  <td className="r mono">{rub(t.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {meta?.next != null && <button className="btn soft sm" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={() => void load(meta.next!)}>Показать еще</button>}
    </div>
  );
}
