"use client";
import Link from "next/link";
import { useState } from "react";
import { Empty, PageHead, Tabs } from "@/components/admin";
import { Ava } from "@/components/ui";
import { dateTime, LEGAL_LABEL, type AdminVerification } from "@/lib/admin";
import { api } from "@/lib/api";
import { useSession, usePoll } from "@/lib/session";

type Tab = "pending" | "approved" | "rejected";
const FNS_TONE = { match: "green", mismatch: "red", unavailable: "amber", none: "gray" } as const;
const FNS_TEXT = { match: "ФНС подтвердила", mismatch: "Расхождение с ФНС", unavailable: "ФНС недоступна", none: "Сверка не проводилась" } as const;

function Item({ v, onDone }: { v: AdminVerification; onDone: () => void }) {
  const { toast } = useSession();
  const [comment, setComment] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fns, setFns] = useState(v.fns);

  async function decide(action: "approve" | "reject") {
    setBusy(true);
    try {
      await api(`/admin/verifications/${v.id}/decision`, { method: "POST", body: { action, comment: comment || undefined, acknowledgeFns: ack } });
      toast(action === "approve" ? "Данные подтверждены" : "Отказ отправлен заявителю");
      onDone();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  }
  async function recheck() {
    setBusy(true);
    try {
      setFns(await api(`/admin/verifications/${v.id}/fns`, { method: "POST", body: {} }));
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stack">
      <div className="row between" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
        <div className="row">
          <Ava name={v.user.name} src={v.user.avatar} />
          <div>
            <Link href={`/users/${v.userId}`} className="adm-a"><b>{v.user.name}</b></Link>
            <div className="small muted">Заявка от {dateTime(v.at)}</div>
          </div>
        </div>
        {v.status !== "pending" && (
          <span className={`chip ${v.status === "approved" ? "green" : "red"}`}>{v.status === "approved" ? "Подтверждено" : "Отказано"}</span>
        )}
      </div>

      <div className="adm-facts">
        <div><span className="eyebrow">Статус</span><b>{LEGAL_LABEL[v.legalStatus]}</b></div>
        <div><span className="eyebrow">ИНН</span><b className="mono">{v.inn}</b></div>
        {v.orgName && <div><span className="eyebrow">Название</span><b>{v.orgName}</b></div>}
        {v.email && <div><span className="eyebrow">Почта</span><b>{v.email}</b></div>}
      </div>

      <div className="note" style={{ margin: 0 }}>
        <div className="row between" style={{ flexWrap: "wrap" }}>
          <span className={`chip ${FNS_TONE[fns?.status ?? "none"]}`}>{FNS_TEXT[fns?.status ?? "none"]}</span>
          {v.status === "pending" && <button className="btn ghost sm" disabled={busy} onClick={() => void recheck()}>Сверить повторно</button>}
        </div>
        {fns && <div className="small" style={{ marginTop: 8 }}>{fns.detail}{fns.name ? ` По данным ФНС: ${fns.name}.` : ""}</div>}
        {fns && <div className="small muted">{fns.source}, {dateTime(fns.checkedAt)}</div>}
      </div>

      {v.status === "pending" ? (
        <div className="stack">
          <textarea className="input" rows={2} placeholder="Комментарий (обязателен при отказе)" value={comment} onChange={(e) => setComment(e.target.value)} />
          {fns?.status === "mismatch" && (
            <label className="row small"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> Расхождение с ФНС мне известно, подтверждаю данные</label>
          )}
          <div className="row" style={{ flexWrap: "wrap" }}>
            <button className="btn green sm" disabled={busy || (fns?.status === "mismatch" && !ack)} onClick={() => void decide("approve")}>Подтвердить</button>
            <button className="btn danger sm" disabled={busy || !comment.trim()} onClick={() => void decide("reject")}>Отказать</button>
          </div>
        </div>
      ) : (
        <div className="small muted">
          Решение принял {v.decidedByName ?? "администратор"}{v.decidedAt ? `, ${dateTime(v.decidedAt)}` : ""}{v.comment ? `. Комментарий: ${v.comment}` : ""}
        </div>
      )}
    </div>
  );
}

export default function Verifications() {
  const [tab, setTab] = useState<Tab>("pending");
  const { data, reload } = usePoll(() => api<AdminVerification[]>(`/admin/verifications?status=${tab}`), [tab], 20_000);
  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead title="Подтверждение данных" sub="Заявки профессиональных аккаунтов: организации, предприниматели и самозанятые. После подтверждения в профиле появляется отметка «Проверено»" />
      <Tabs value={tab} onChange={setTab} items={[{ id: "pending", label: "На рассмотрении", count: tab === "pending" ? data?.length : undefined }, { id: "approved", label: "Подтверждены" }, { id: "rejected", label: "Отказано" }]} />
      {!data && <div className="skeleton" />}
      {data?.length === 0 && <Empty text="Заявок нет" />}
      <div className="adm-grid2">{data?.map((v) => <Item key={v.id} v={v} onDone={() => void reload()} />)}</div>
    </div>
  );
}
