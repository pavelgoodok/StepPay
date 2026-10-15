"use client";
import Link from "next/link";
import { useState } from "react";
import { IMG, Icon, Sheet } from "@/components/ui";
import { api } from "@/lib/api";
import { rub } from "@/lib/format";
import { usePoll } from "@/lib/session";

interface Receipt {
  id: number;
  number: string;
  at: number;
  amount: number;
  service: string;
  dealId: string;
  payer: string | null;
  executor: string;
}

const when = (t: number) => new Date(t).toLocaleString("ru-RU", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Печать StepPay: круглая, с кольцевой надписью и датой проведения. */
function Stamp({ date }: { date: string }) {
  return (
    <svg className="stamp" viewBox="0 0 160 160" width="132" height="132" role="img" aria-label="Печать StepPay">
      <defs>
        <path id="stamp-top" d="M 24 80 A 56 56 0 0 1 136 80" />
        <path id="stamp-bot" d="M 20 80 A 60 60 0 0 0 140 80" />
      </defs>
      <circle cx="80" cy="80" r="74" fill="none" stroke="currentColor" strokeWidth="3" />
      <circle cx="80" cy="80" r="68" fill="none" stroke="currentColor" strokeWidth="1" />
      <circle cx="80" cy="80" r="40" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <text fontSize="13" fontWeight="800" letterSpacing="2.2" fill="currentColor"><textPath href="#stamp-top" startOffset="50%" textAnchor="middle">STEPPAY · ОПЛАТА ПО ШАГАМ</textPath></text>
      <text fontSize="12" fontWeight="700" letterSpacing="2" fill="currentColor"><textPath href="#stamp-bot" startOffset="50%" textAnchor="middle">ЦИФРОВОЙ РУБЛЬ</textPath></text>
      <text x="80" y="74" textAnchor="middle" fontSize="15" fontWeight="800" fill="currentColor">ПРОВЕДЕНО</text>
      <text x="80" y="94" textAnchor="middle" fontSize="9.5" fontWeight="600" fill="currentColor">{date}</text>
    </svg>
  );
}

export default function Receipts() {
  const { data } = usePoll(() => api<Receipt[]>("/receipts"), []);
  const [open, setOpen] = useState<Receipt | null>(null);
  const total = (data ?? []).reduce((a, r) => a + r.amount, 0);

  return (
    <div className="page">
      <Link href="/profile" className="btn ghost sm" style={{ paddingLeft: 0, alignSelf: "flex-start" }}><Icon name="back" size={18} /> Профиль</Link>
      <h1 className="h1">Мои чеки</h1>
      <p className="sub">Чек формируется автоматически при каждой выплате за принятый этап.</p>
      {data && data.length > 0 && <div className="card row between"><span className="muted">Всего за год</span><b className="mono">{rub(total)}</b></div>}
      {!data && <div className="skeleton" />}
      {data && data.length === 0 && (
        <div className="empty">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={IMG.accept} alt="" />
          <p style={{ marginTop: 8 }}>Чеки появятся после первой выплаты за этап</p>
        </div>
      )}
      {data?.map((r) => (
        <button key={r.id} className="card tap row" style={{ textAlign: "left", width: "100%", display: "flex" }} onClick={() => setOpen(r)}>
          <Icon name="check" size={26} />
          <div className="grow">
            <div className="title">№ {r.number}</div>
            <div className="sub ellipsis">{r.service}</div>
          </div>
          <b className="mono">{rub(r.amount)}</b>
        </button>
      ))}

      {open && (
        <Sheet onClose={() => setOpen(null)}>
          <div className="receipt printable" style={{ marginTop: 8 }}>
            <div className="small muted">Демонстрационный чек</div>
            <h2 style={{ fontSize: 22, textAlign: "left", margin: "4px 0 12px" }}>Чек № {open.number}</h2>
            <div className="stack" style={{ gap: 6 }}>
              <div className="row between"><span className="muted">Дата</span><span>{when(open.at)}</span></div>
              <div className="row between"><span className="muted">Исполнитель</span><span>{open.executor}</span></div>
              <div className="row between"><span className="muted">Плательщик</span><span>{open.payer ?? "Спонсоры проекта"}</span></div>
              <div className="muted" style={{ marginTop: 6 }}>Наименование услуги</div>
              <div>{open.service}</div>
              <div className="row between" style={{ marginTop: 10, fontSize: 20 }}><b>Итого</b><b className="mono">{rub(open.amount)}</b></div>
              <div className="small muted">Оплата цифровыми рублями через StepPay</div>
            </div>
            <Stamp date={when(open.at)} />
          </div>
          <p className="small muted" style={{ margin: "12px 0" }}>В демо чек только имитирует «Мой налог»: в продукте он регистрируется в ФНС для самозанятых автоматически.</p>
          <button className="btn soft" onClick={() => window.print()}>Распечатать или сохранить в PDF</button>
        </Sheet>
      )}
    </div>
  );
}
