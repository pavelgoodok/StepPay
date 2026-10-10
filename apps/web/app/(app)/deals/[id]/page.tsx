"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PhotoGrid, PhotoPicker } from "@/components/photos";
import { IMG, Icon, Sheet } from "@/components/ui";
import { api, type DealFull } from "@/lib/api";
import { rub, timeLeft, toKopecks } from "@/lib/format";
import { MODE_LABEL, STAGE_LABEL, dealChip, nameOf } from "@/lib/labels";
import { useSession, usePoll } from "@/lib/session";

type Stage = DealFull["stages"][number];
type Ask = { kind: "submit" | "reject" | "dispute" | "reply" | "pay" | "refund"; stage: Stage } | null;

const CLOSED_BY: Record<string, string> = {
  owner: "Принят заказчиком",
  votes: "Решение спонсоров",
  auto: "Принят автоматически: ответа не было 3 дня",
  arbiter: "Решение независимого приёмщика",
};

export default function DealPage() {
  const { id } = useParams<{ id: string }>();
  const { user, wallet, users, toast, refresh } = useSession();
  const { data: d, error, reload } = usePoll(() => api<DealFull>(`/deals/${id}`), [id]);
  const [now, setNow] = useState(() => Date.now());
  const [ask, setAsk] = useState<Ask>(null);
  const [text, setText] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  if (error && !d) return <div className="page"><Link href="/deals" className="btn ghost sm"><Icon name="back" size={18} /> Назад</Link><div className="note bad">{error}</div></div>;
  if (!d || !user) return <div className="page"><div className="skeleton" /><div className="skeleton" /></div>;

  const me = user.id;
  const isOwner = d.ownerId === me;
  const isExec = d.executorId === me;
  const isArbiter = d.arbiterId === me;
  const myContribution = d.contributed[me] ?? 0;
  const chip = dealChip(d.summary);
  const paid = d.stages.filter((s) => s.status === "accepted").reduce((a, s) => a + s.amount, 0);
  const reservedLeft = Object.values(d.reserves).reduce((a, b) => a + b, 0);
  const raised = d.summary.raised;
  const crowd = d.mode === "crowdfunding";
  const canCancel =
    d.status !== "completed" && d.status !== "cancelled" &&
    (crowd ? isExec : isOwner) &&
    !d.stages.some((s) => s.status === "submitted" || s.status === "disputed");

  async function run(path: string, body: unknown = {}, ok?: string) {
    setBusy(true);
    try {
      await api(`/deals/${id}${path}`, { method: "POST", body });
      if (ok) toast(ok);
      setAsk(null);
      setText("");
      setPhotos([]);
      setAmount("");
      await Promise.all([reload(), refresh()]);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  }

  const missing = d.target - Object.values(d.reserves).reduce((a, b) => a + b, 0);

  return (
    <div className="page">
      <div className="row between">
        <Link href="/deals" className="btn ghost sm" style={{ paddingLeft: 0 }}><Icon name="back" size={18} /> Сделки</Link>
        <span className={`chip ${chip.tone}`}>{chip.text}</span>
      </div>

      <div>
        <div className="small muted">{MODE_LABEL[d.mode]}</div>
        <h1 className="h1" style={{ fontSize: 28 }}>{d.title}</h1>
        <div className="sub">
          Исполнитель: {nameOf(users, d.executorId)}
          {d.ownerId && <> · {d.mode === "grant" ? "Грантодатель" : "Заказчик"}: {nameOf(users, d.ownerId)}</>}
        </div>
      </div>

      <div className="hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="art" src={d.status === "completed" ? IMG.terminal : IMG.safe} alt="" />
        <div className="label">Выплачено исполнителю</div>
        <div className="big mono">{rub(paid)}</div>
        <div style={{ maxWidth: 190 }}>
          <div className="meter" style={{ background: "rgba(255,255,255,.28)" }}>
            <b style={{ width: `${d.target ? (paid / d.target) * 100 : 0}%`, background: "#fff" }} />
          </div>
          <div className="small" style={{ marginTop: 8, opacity: 0.9 }}>из {rub(d.target)}</div>
        </div>
        {reservedLeft > 0 && <div className="pill" style={{ marginTop: 12 }}><Icon name="lock" size={15} /> {rub(reservedLeft)} в резерве</div>}
      </div>

      {d.status === "funding" && (
        <div className="card stack">
          {crowd ? (
            <>
              <div className="row between"><b>Собрано {rub(raised)}</b><span className="muted">из {rub(d.target)}</span></div>
              <div className="meter"><b style={{ width: `${(raised / d.target) * 100}%` }} /></div>
              <div className="small muted">{d.summary.sponsors} спонсоров. Автор получает деньги только за принятые этапы — не сдан этап, остаток вернётся вам.</div>
              {!isExec && (
                <>
                  <div className="chips">
                    {[1000, 5000, 10000, 50000].filter((v) => toKopecks(v) <= missing).map((v) => (
                      <button key={v} className="opt" onClick={() => setAmount(String(v))}>{rub(toKopecks(v))}</button>
                    ))}
                    <button className="opt" onClick={() => setAmount(String(Math.floor(missing / 100)))}>Всё недостающее</button>
                  </div>
                  <input className="input" inputMode="numeric" placeholder="Сумма, ₽" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} />
                  <button className="btn" disabled={busy || !Number(amount)} onClick={() => run("/fund", { amount: toKopecks(Number(amount)) }, "Деньги зарезервированы")}>
                    Поддержать{Number(amount) ? ` на ${rub(toKopecks(Number(amount)))}` : ""}
                  </button>
                  <div className="small muted">В кошельке {rub(wallet?.free ?? 0)}</div>
                </>
              )}
            </>
          ) : isOwner ? (
            <>
              <div className="title">Зарезервируйте {rub(d.target)}</div>
              <div className="small muted">Деньги будут заморожены в кошельке и уйдут исполнителю только за принятые этапы. Исполнитель увидит, что деньги есть.</div>
              <button className="btn" disabled={busy || (wallet?.free ?? 0) < d.target} onClick={() => run("/fund", {}, "Резерв создан")}>
                <Icon name="lock" size={18} /> Зарезервировать
              </button>
              {(wallet?.free ?? 0) < d.target && <div className="note warn">Не хватает {rub(d.target - (wallet?.free ?? 0))}. Пополните кошелёк на вкладке «Кошелёк».</div>}
            </>
          ) : (
            <div className="row"><Icon name="clock" size={22} /><div className="sub">Ждём, пока {d.mode === "grant" ? "грантодатель" : "заказчик"} зарезервирует деньги</div></div>
          )}
        </div>
      )}

      <div className="timeline">
        {d.stages.map((s, i) => {
          const left = s.submittedAt ? s.submittedAt + d.autoAcceptMs - now : 0;
          const votesAccept = Object.entries(s.votes).filter(([, v]) => v === "accept").reduce((a, [u]) => a + (d.contributed[u] ?? 0), 0);
          const voted = s.votes[me];
          return (
            <div key={s.id} className={`node ${s.status}`}>
              <div className="dot">{s.status === "accepted" ? <Icon name="check" size={18} /> : i + 1}</div>
              <div className="body card" style={{ boxShadow: s.status === "active" || s.status === "submitted" ? undefined : "none" }}>
                <div className="row between">
                  <div className="title">{s.title}</div>
                  <b className="mono">{rub(s.amount)}</b>
                </div>
                <div className="small muted" style={{ marginTop: 2 }}>{STAGE_LABEL[s.status]}</div>
                {s.criteria.length > 0 && <ul className="crit">{s.criteria.map((c) => <li key={c}>{c}</li>)}</ul>}
                {(s.evidence?.note || s.evidence?.photos?.length) && (
                  <div className="note">
                    {s.evidence?.note && <div><b>От исполнителя:</b> {s.evidence.note}</div>}
                    <PhotoGrid photos={s.evidence?.photos} />
                  </div>
                )}
                {s.messages && s.messages.length > 0 && (
                  <div className="thread">
                    <div className="small muted"><b>Спор</b></div>
                    {s.messages.map((m, k) => (
                      <div key={k} className={`msg ${m.by === me ? "me" : ""}`}>
                        <div className="who">{nameOf(users, m.by)}{m.by === d.arbiterId ? " · приёмщик" : ""}</div>
                        {m.text}
                        <PhotoGrid photos={m.photos} />
                      </div>
                    ))}
                  </div>
                )}
                {s.resolution && (s.resolution.by !== "owner" || s.resolution.comment || s.status === "failed") && (
                  <div className={`verdict ${s.resolution.decision === "failed" ? "bad" : ""}`}>
                    <b>{s.resolution.decision === "failed" && s.resolution.by === "owner" ? "Этап не принят" : CLOSED_BY[s.resolution.by]}</b>
                    {s.resolution.comment && <div style={{ marginTop: 4 }}>{s.resolution.comment}</div>}
                  </div>
                )}

                {s.status === "active" && isExec && d.status === "active" && (
                  <button className="btn" style={{ marginTop: 12 }} onClick={() => { setAsk({ kind: "submit", stage: s }); setText(""); }}>
                    <Icon name="flag" size={18} /> Сдать этап
                  </button>
                )}

                {s.status === "submitted" && (
                  <div className="stack" style={{ marginTop: 12 }}>
                    {d.mode !== "grant" && <div className="note warn"><Icon name="clock" size={14} /> Автоприёмка через {timeLeft(left)}</div>}
                    {!crowd && isOwner && (
                      <div className="btns">
                        <button className="btn green" disabled={busy} onClick={() => run(`/stages/${s.id}/approve`, {}, "Этап принят, деньги отправлены")}>Принял</button>
                        <button className="btn danger" disabled={busy} onClick={() => { setAsk({ kind: "reject", stage: s }); setText(""); }}>{d.mode === "grant" ? "Отклонить" : "Отказать"}</button>
                      </div>
                    )}
                    {crowd && myContribution > 0 && (
                      <>
                        <div className="small muted">Приняли {Math.round((votesAccept / Math.max(1, raised)) * 100)}% спонсоров по весу взносов{voted ? ` · ваш голос: ${voted === "accept" ? "за" : "против"}` : ""}</div>
                        <div className="btns">
                          <button className="btn green" disabled={busy} onClick={() => run(`/stages/${s.id}/vote`, { vote: "accept" }, "Голос учтён")}>Принять</button>
                          <button className="btn danger" disabled={busy} onClick={() => run(`/stages/${s.id}/vote`, { vote: "reject" }, "Голос учтён")}>Отклонить</button>
                        </div>
                      </>
                    )}
                    {d.mode === "own" && (isOwner || isExec) && (
                      <button className="btn ghost sm" onClick={() => { setAsk({ kind: "dispute", stage: s }); setText(""); }}>Открыть спор</button>
                    )}
                  </div>
                )}

                {s.status === "disputed" && (isOwner || isExec || isArbiter) && (
                  <button className="btn soft" style={{ marginTop: 12 }} onClick={() => { setAsk({ kind: "reply", stage: s }); setText(""); setPhotos([]); }}>
                    <Icon name="camera" size={18} /> {isArbiter ? "Задать вопрос сторонам" : "Ответить / добавить фото"}
                  </button>
                )}
                {s.status === "disputed" && isArbiter && (
                  <div className="btns" style={{ marginTop: 10 }}>
                    <button className="btn green" disabled={busy} onClick={() => { setAsk({ kind: "pay", stage: s }); setText(""); }}>Выплатить</button>
                    <button className="btn danger" disabled={busy} onClick={() => { setAsk({ kind: "refund", stage: s }); setText(""); }}>Вернуть</button>
                  </div>
                )}
                {s.status === "disputed" && !isArbiter && <div className="note warn" style={{ marginTop: 10 }}>Деньги за этап заморожены до решения независимого приёмщика</div>}
              </div>
            </div>
          );
        })}
      </div>

      {crowd && Object.keys(d.contributed).length > 0 && (
        <div className="card stack">
          <div className="title">Спонсоры</div>
          {Object.entries(d.contributed).map(([uid, v]) => (
            <div key={uid} className="row between"><span>{nameOf(users, uid)}</span><b className="mono">{rub(v)}</b></div>
          ))}
        </div>
      )}

      {canCancel && (
        <button className="btn danger" disabled={busy} onClick={() => confirm("Отменить сделку? Неиспользованный резерв вернётся.") && run("/cancel", {}, "Сделка отменена, остаток возвращён")}>
          Отменить сделку и вернуть остаток
        </button>
      )}

      {ask && (() => {
        const k = ask.kind;
        const title = { submit: `Сдать этап «${ask.stage.title}»`, reject: "Причина отказа", dispute: "Причина спора", reply: "Сообщение в споре", pay: "Выплатить исполнителю", refund: "Вернуть деньги заказчику" }[k];
        const needText = k === "reject" || k === "dispute";
        const hasPhotos = k === "submit" || k === "reply";
        const label = { submit: "Сдать на приёмку", reject: "Отправить отказ", dispute: "Открыть спор", reply: "Отправить", pay: "Подтвердить выплату", refund: "Подтвердить возврат" }[k];
        const base = `/stages/${ask.stage.id}`;
        const go = () => {
          if (k === "submit") return run(`${base}/submit`, { note: text.trim() || undefined, photos }, "Этап сдан, ждём приёмки");
          if (k === "reject") return run(`${base}/reject`, { reason: text }, d.mode === "grant" ? "Этап отклонён, остаток возвращён" : "Отказ отправлен, открыт спор");
          if (k === "dispute") return run(`${base}/dispute`, { reason: text }, "Спор открыт");
          if (k === "reply") return run(`${base}/reply`, { text, photos }, "Сообщение отправлено");
          return run(`${base}/resolve`, { decision: k, comment: text.trim() || undefined }, k === "pay" ? "Решено: выплатить исполнителю" : "Решено: вернуть заказчику");
        };
        return (
          <Sheet onClose={() => setAsk(null)}>
            <h2 style={{ fontSize: 22, textAlign: "left" }}>{title}</h2>
            <div className="stack" style={{ marginTop: 14 }}>
              <textarea className="input" autoFocus placeholder={k === "submit" ? "Что сделано, на что обратить внимание" : k === "pay" || k === "refund" ? "Пояснение к решению (необязательно)" : "Опишите"} value={text} onChange={(e) => setText(e.target.value)} />
              {hasPhotos && <PhotoPicker value={photos} onChange={setPhotos} />}
              <button className={`btn ${k === "submit" || k === "reply" || k === "pay" ? "" : "danger"}`} disabled={busy || (needText && !text.trim()) || (k === "reply" && !text.trim() && photos.length === 0)} onClick={go}>{label}</button>
            </div>
          </Sheet>
        );
      })()}
    </div>
  );
}
