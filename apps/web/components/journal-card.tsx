"use client";
import { useState } from "react";
import { verifyJournal, type JournalEntry } from "@steppay/engine";
import type { DealFull } from "@/lib/api";
import { rub } from "@/lib/format";
import { Icon, Sheet } from "./ui";

const when = (ts: number) => new Date(ts).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Что произошло, простыми словами. */
function describe(e: JournalEntry, d: DealFull): string {
  const who = e.by === "system" ? "Платформа" : (d.people[e.by]?.name ?? "Участник");
  const stage = e.stageId ? d.stages.find((s) => s.id === e.stageId)?.title : undefined;
  const st = stage ? ` «${stage}»` : "";
  const data = e.data ?? {};
  const money = typeof data.amount === "number" ? rub(data.amount) : "";
  switch (e.type) {
    case "created": return "Сделка создана";
    case "terms_sealed": return `${who} отправил(а) условия, контракт зафиксирован`;
    case "terms_reopened": return `${who} вернул(а) условия на согласование`;
    case "reserved": return `${who} зарезервировал(а) ${money}`;
    case "stage_submitted": return `${who} сдал(а) этап${st}`;
    case "stage_accepted": return e.by === "system" ? `Этап${st} принят автоматически` : `${who} принял(а) этап${st}`;
    case "stage_failed": return `Этап${st} не принят`;
    case "stage_rejected": return `${who} отказал(а) по этапу${st}`;
    case "vote": return `${who} проголосовал(а) ${data.vote === "accept" ? "за" : "против"}${st ? ` по этапу${st}` : ""}`;
    case "dispute_opened": return `${who} открыл(а) спор по этапу${st}`;
    case "dispute_reply": return `${who} ответил(а) в споре`;
    case "payout": return `Исполнителю выплачено ${money}`;
    case "refund": return `Возврат ${money} ${typeof data.to === "string" ? `участнику ${d.people[data.to]?.name ?? ""}` : ""}`.trim();
    case "completed": return "Сделка завершена";
    case "cancelled": return `${who} отменил(а) сделку`;
    default: return e.type;
  }
}

/** Журнал событий сделки с цепочкой хешей: проверка на устройстве и выгрузка для разбора спора. */
export function JournalCard({ d }: { d: DealFull }) {
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState<"ok" | "bad" | null>(null);
  const entries = d.journal ?? [];
  if (entries.length === 0) return null;
  const ok = d.journalCheck.ok;

  function verify() {
    setLocal(verifyJournal({ ...d }).ok ? "ok" : "bad");
  }
  function download() {
    const blob = new Blob([JSON.stringify({ dealId: d.id, title: d.title, contract: d.contract, head: d.journalCheck.head, entries }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `journal-${d.id}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <>
      <button className="card tap row" style={{ textAlign: "left", width: "100%" }} onClick={() => setOpen(true)}>
        <span className="setic"><Icon name="clock" size={20} /></span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="title">Журнал сделки</div>
          <div className="small muted">{entries.length} записей</div>
        </div>
        <span className={`chip ${ok ? "green" : "red"}`}>{ok ? "Цепочка цела" : "Цепочка нарушена"}</span>
      </button>

      {open && (
        <Sheet onClose={() => setOpen(false)}>
          <h2 style={{ fontSize: 22, textAlign: "left" }}>Журнал сделки</h2>
          <div className="stack" style={{ marginTop: 14 }}>
            <div className="sub">Каждая запись хранит хеш предыдущей. Подмена, удаление или перестановка записей ломает цепочку, и проверка это покажет.</div>
            <div className="jlist">
              {[...entries].reverse().map((e) => (
                <div key={e.n} className="jitem">
                  <div className="row between"><b>{describe(e, d)}</b><span className="small muted" style={{ whiteSpace: "nowrap" }}>{when(e.at)}</span></div>
                  <div className="small muted mono">№{e.n} · {e.hash.slice(0, 10)}</div>
                </div>
              ))}
            </div>
            {d.journalCheck.head && (
              <div className="note" style={{ marginTop: 0 }}>
                <div className="small muted">Хеш последней записи</div>
                <div className="mono small" style={{ wordBreak: "break-all" }}>{d.journalCheck.head}</div>
              </div>
            )}
            {local && <div className={`note ${local === "ok" ? "" : "bad"}`} style={{ marginTop: 0 }}>{local === "ok" ? `Цепочка из ${entries.length} записей пересчитана на этом устройстве и цела.` : "Цепочка не сходится: журнал был изменен."}</div>}
            <div className="btns">
              <button className="btn soft" onClick={verify}>Проверить целостность</button>
              <button className="btn soft" onClick={download}>Скачать журнал</button>
            </div>
          </div>
        </Sheet>
      )}
    </>
  );
}
