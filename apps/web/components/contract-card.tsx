"use client";
import { useState } from "react";
import { contractHash, type ContractTerms } from "@steppay/engine";
import type { DealFull } from "@/lib/api";
import { dayLabel, rub } from "@/lib/format";
import { verifyProofLocally } from "@/lib/keys";
import { Icon, Sheet } from "./ui";

const DAY = 86_400_000;

const daysOf = (ms: number) => Math.round(ms / DAY);

/** Сроки аварийного выхода: если сторона пропала, деньги возвращаются без чьего-либо согласия. */
function deadlines(t: ContractTerms) {
  const out: string[] = [];
  if (t.fundingDeadlineMs) out.push(`Если сумма не собрана за ${daysOf(t.fundingDeadlineMs)} дн., сделка закрывается и взносы возвращаются.`);
  if (t.stageDeadlineMs) out.push(`Если исполнитель не сдал этап за ${daysOf(t.stageDeadlineMs)} дн., остаток возвращается.`);
  if (t.disputeMs) out.push(`Если приемщик не решил спор за ${daysOf(t.disputeMs)} дн., остаток возвращается заказчику.`);
  return out.join(" ");
}

function rules(t: ContractTerms) {
  return [baseRules(t), deadlines(t)].filter(Boolean).join(" ");
}

function baseRules(t: ContractTerms) {
  const days = Math.round(t.autoAcceptMs / DAY);
  if (t.mode === "own") return `Этап принимает заказчик. Если он отказывает, спор решает независимый приемщик. Если заказчик не отвечает ${days} дня, этап принимается сам.`;
  if (t.mode === "crowdfunding") return `Этап принимают спонсоры голосованием, вес голоса равен сумме взноса. Если этап не принят, остаток возвращается спонсорам. Если спонсоры не отвечают ${days} дня, этап принимается сам.`;
  return "Этап принимает грантодатель. Если этап не принят, остаток возвращается грантодателю.";
}

/** Контракт сделки: зафиксированные условия, хеш и проверка на устройстве. */
export function ContractCard({ d }: { d: DealFull }) {
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState<"ok" | "bad" | null>(null);
  const [sigs, setSigs] = useState<string | null>(null);
  if (!d.contract) return null;
  const ok = d.contractCheck.ok;
  const short = `${d.contract.hash.slice(0, 8)}…${d.contract.hash.slice(-6)}`;

  function verify() {
    setLocal(contractHash(d.terms) === d.contract!.hash ? "ok" : "bad");
  }
  async function verifySignatures() {
    const proofs = Object.entries(d.signatures ?? {}).filter(([, v]) => v.proof);
    const server = Object.keys(d.signatures ?? {}).length - proofs.length;
    let ok = 0;
    for (const [u, v] of proofs) if (await verifyProofLocally(v.proof!, { dealId: d.id, contract: v.hash, userId: u })) ok++;
    if (proofs.length === 0) setSigs("Подписей ключами устройств пока нет");
    else if (ok === proofs.length) setSigs(`Подписи ключами проверены на этом устройстве: ${ok}${server ? `. Серверных демо-подписей: ${server}, они здесь не проверяются` : ""}`);
    else setSigs("Одна из подписей не прошла проверку");
  }
  function download() {
    const blob = new Blob([JSON.stringify({ dealId: d.id, hash: d.contract!.hash, sealedAt: d.contract!.sealedAt, terms: d.terms }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `contract-${d.id}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <>
      <button className="card tap row" style={{ textAlign: "left", width: "100%" }} onClick={() => setOpen(true)}>
        <span className="setic"><Icon name="shield" size={20} /></span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="title">Контракт</div>
          <div className="small muted mono ellipsis">{short}</div>
        </div>
        <span className={`chip ${ok ? "green" : "red"}`}>{ok ? "Без изменений" : "Изменены"}</span>
      </button>

      {open && (
        <Sheet onClose={() => setOpen(false)}>
          <h2 style={{ fontSize: 22, textAlign: "left" }}>Контракт сделки</h2>
          <div className="stack" style={{ marginTop: 14 }}>
            <div className="sub">Условия зафиксированы {dayLabel(d.contract.sealedAt)} и больше не меняются. Любая правка меняет хеш, а деньги при несовпадении не двигаются.</div>
            <div className="note" style={{ marginTop: 0 }}>
              <div className="small muted">Стороны</div>
              <div>Исполнитель: {d.people[d.terms.executorId]?.name}</div>
              {d.terms.ownerId && <div>{d.mode === "grant" ? "Грантодатель" : "Заказчик"}: {d.people[d.terms.ownerId]?.name}</div>}
              {d.terms.arbiterId && <div>Приемщик споров: {d.people[d.terms.arbiterId]?.name ?? "независимый"}</div>}
            </div>
            <div className="note" style={{ marginTop: 0 }}>
              <div className="small muted">Этапы, всего {rub(d.terms.target)}</div>
              {d.terms.stages.map((s, i) => (
                <div key={s.id} style={{ marginTop: 6 }}>
                  <div className="row between"><span>{i + 1}. {s.title}</span><b className="mono">{rub(s.amount)}</b></div>
                  {s.criteria.length > 0 && <div className="small muted">Критерии: {s.criteria.join("; ")}</div>}
                </div>
              ))}
            </div>
            <div className="note" style={{ marginTop: 0 }}>
              <div className="small muted">Правила</div>
              <div>{rules(d.terms)}</div>
            </div>
            {d.signatureStatus.required.length > 0 && (
              <div className="note" style={{ marginTop: 0 }}>
                <div className="small muted">Подписи</div>
                {d.signatureStatus.required.map((u) => {
                  const sg = d.signatures?.[u];
                  const done = d.signatureStatus.signed.includes(u);
                  return (
                    <div key={u} className="row between" style={{ marginTop: 6 }}>
                      <span>{d.people[u]?.name ?? "Участник"}</span>
                      <span className={`chip ${done && d.signatureStatus.valid[u] ? "green" : done ? "red" : "amber"}`}>
                        {done ? (d.signatureStatus.valid[u] ? `Подписал(а) ${dayLabel(sg!.at)}` : "Подпись не подтверждена") : "Ждет подписи"}
                      </span>
                    </div>
                  );
                })}
                {d.signatureStatus.required.map((u) => {
                  const sg = d.signatures?.[u];
                  return sg && d.signatureStatus.signed.includes(u) ? (
                    <div key={u} className="small muted" style={{ marginTop: 4 }}>{d.people[u]?.name}: {sg.proof ? `ключ устройства ${sg.proof.keyId}` : "демо-подпись сервера"}</div>
                  ) : null;
                })}
                <div className="small muted" style={{ marginTop: 8 }}>Подпись ключом устройства создается на вашем телефоне, закрытый ключ не покидает его. Это не квалифицированная электронная подпись: юридическая сила требует удостоверяющего центра.</div>
                {sigs && <div className="small" style={{ marginTop: 6 }}>{sigs}</div>}
                <button className="btn ghost sm" style={{ paddingLeft: 0, marginTop: 4 }} onClick={() => void verifySignatures()}>Проверить подписи на этом устройстве</button>
              </div>
            )}
            <div className="note" style={{ marginTop: 0 }}>
              <div className="small muted">Хеш SHA-256</div>
              <div className="mono small" style={{ wordBreak: "break-all" }}>{d.contract.hash}</div>
            </div>
            {local && <div className={`note ${local === "ok" ? "" : "bad"}`} style={{ marginTop: 0 }}>{local === "ok" ? "Хеш пересчитан на этом устройстве и совпал с зафиксированным." : "Хеш не совпал: условия были изменены."}</div>}
            <div className="btns">
              <button className="btn soft" onClick={verify}>Проверить хеш</button>
              <button className="btn soft" onClick={download}>Скачать условия</button>
            </div>
          </div>
        </Sheet>
      )}
    </>
  );
}
