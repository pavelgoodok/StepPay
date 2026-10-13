"use client";
import Link from "next/link";
import { useState } from "react";
import { IMG, Icon, Money, MoneyInput, Sheet, StageBars } from "@/components/ui";
import { api, type WalletView } from "@/lib/api";
import { dayLabel, rub, toKopecks } from "@/lib/format";
import { LEDGER_LABEL } from "@/lib/labels";
import { useSession, usePoll } from "@/lib/session";

const ICON: Record<string, string> = { topup: "plus", reserve: "lock", payout: "check", refund: "swap", fee: "shield" };

export default function WalletPage() {
  const { toast, refresh, features } = useSession();
  const { data, reload } = usePoll(() => api<WalletView>("/wallet"), []);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  async function topup() {
    setBusy(true);
    try {
      await api("/wallet/topup", { method: "POST", body: { amount: toKopecks(Number(amount)) } });
      setOpen(false);
      setAmount("");
      await Promise.all([reload(), refresh()]);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  }

  const groups: Record<string, WalletView["history"]> = {};
  data?.history.forEach((h) => (groups[dayLabel(h.at)] ??= []).push(h));

  return (
    <div className="page">
      <h1 className="h1">Кошелек</h1>
      <div className="hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="art" src={IMG.wallet} alt="" />
        <div className="label">Цифровой рубль</div>
        <div className="big"><Money value={data?.free ?? 0} /></div>
        <div className="label" style={{ marginTop: -6, marginBottom: 12 }}>Свободно для оплаты</div>
        <span className="pill"><Icon name="lock" size={15} /> {rub(data?.reserved ?? 0)} в резерве</span>
      </div>

      <div className="btns">
        {features.topup ? (
          <button className="btn soft" onClick={() => setOpen(true)}><Icon name="plus" size={18} /> Пополнить</button>
        ) : (
          <button className="btn soft" onClick={() => toast("Пополнение подключается к платежной платформе")}><Icon name="plus" size={18} /> Пополнить</button>
        )}
        <button className="btn soft" onClick={() => toast("В демо переводы отключены")}><Icon name="arrow" size={18} /> Перевести</button>
      </div>

      {data && data.reserves.length > 0 && (
        <>
          <h2 className="title">Резервы по сделкам</h2>
          <div className="card stack" style={{ gap: 14 }}>
            {data.reserves.map((r) => (
              <Link key={r.dealId} href={`/deals/${r.dealId}`} className="stack" style={{ gap: 0 }}>
                <div className="row between"><b>{r.title}</b><b className="mono">{rub(r.amount)}</b></div>
                <StageBars done={r.stages.done} total={r.stages.total} />
                <div className="small muted">Принято {r.stages.done} из {r.stages.total} этапов</div>
              </Link>
            ))}
          </div>
        </>
      )}

      <div className="card row" style={{ background: "var(--blue-soft)", boxShadow: "none" }}>
        <Icon name="shield" size={30} />
        <div><b>Хранится на платформе Банка России</b><div className="sub">Платежи и переводы для граждан - без комиссии (в демо - эмуляция)</div></div>
      </div>

      <h2 className="title">История</h2>
      {!data && <div className="skeleton" />}
      {data && data.history.length === 0 && <div className="empty">Операций пока нет</div>}
      {Object.entries(groups).map(([day, items]) => (
        <div key={day}>
          <div className="small muted">{day}</div>
          <div className="card" style={{ padding: "4px 14px", marginTop: 6 }}>
            {items.map((h) => {
              const plus = h.type === "topup" || h.type === "refund" || h.type === "payout" || h.type === "fee";
              return (
                <div key={h.id} className="hist">
                  <div className="ic"><Icon name={ICON[h.type] ?? "check"} size={20} /></div>
                  <div><div style={{ fontWeight: 600 }}>{LEDGER_LABEL[h.type]}</div>{h.note && <div className="small muted">{h.note}</div>}</div>
                  <div className={`mono ${plus ? "pos" : "neg"}`}>{rub(plus ? h.amount : -h.amount, { sign: true })}</div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {open && (
        <Sheet onClose={() => setOpen(false)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="art" src={IMG.reserve} alt="" />
          <h2>Пополнить кошелек</h2>
          <p className="sub" style={{ textAlign: "center", marginBottom: 14 }}>Демо: деньги появятся мгновенно</p>
          <div className="stack">
            <div className="chips" style={{ justifyContent: "center" }}>
              {[10000, 50000, 100000, 300000].map((v) => <button key={v} className={`opt ${amount === String(v) ? "on" : ""}`} onClick={() => setAmount(String(v))}>{rub(toKopecks(v))}</button>)}
            </div>
            <MoneyInput placeholder="Сумма, ₽" value={amount} onChange={setAmount} />
            <button className="btn" disabled={busy || !Number(amount)} onClick={topup}>Пополнить</button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
