"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ChainCard } from "@/components/chain-card";
import { ContractCard } from "@/components/contract-card";
import { JournalCard } from "@/components/journal-card";
import { PhotoGrid, PhotoPicker } from "@/components/photos";
import { useChangedIds } from "@/components/motion";
import { StageEditor, rowsToStages, rowsTotal, stagesToRows, type Row } from "@/components/stage-editor";
import { IMG, Icon, Money, MoneyInput, SegBar, Sheet } from "@/components/ui";
import { api, type DealFull } from "@/lib/api";
import { deviceKeysAvailable, ensureDeviceKey, signContractOnDevice } from "@/lib/keys";
import { dayLabel, rub, timeLeft, toKopecks } from "@/lib/format";
import { MODE_LABEL, STAGE_LABEL, dealChip } from "@/lib/labels";
import { useSession, usePoll } from "@/lib/session";

type Stage = DealFull["stages"][number];
type Ask = { kind: "submit" | "reject" | "dispute" | "reply" | "pay" | "refund"; stage: Stage } | null;

const CLOSED_BY: Record<string, string> = {
  owner: "Принят заказчиком",
  votes: "Решение спонсоров",
  auto: "Принят автоматически: ответа не было 3 дня",
  arbiter: "Решение независимого приемщика",
  expired: "Срок вышел: остаток возвращен",
};

export default function DealPage() {
  const { id } = useParams<{ id: string }>();
  const { user, wallet, toast, refresh } = useSession();
  const { data: d, error, reload } = usePoll(() => api<DealFull>(`/deals/${id}`), [id]);
  const [now, setNow] = useState(() => Date.now());
  const [ask, setAsk] = useState<Ask>(null);
  const [text, setText] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // обновления в реальном времени: у какого этапа сменился статус, и не принят ли он только что (тогда по карточке расходится круг)
  const changed = useChangedIds(Object.fromEntries((d?.stages ?? []).map((x) => [x.id, x.status])), 1800);
  const paidBurst = (d?.stages ?? []).some((x) => changed.has(x.id) && x.status === "accepted");

  if (error && !d) return <div className="page"><Link href="/deals" className="btn ghost sm"><Icon name="back" size={18} /> Назад</Link><div className="note bad">{error}</div></div>;
  if (!d || !user) return <div className="page"><div className="skeleton" /><div className="skeleton" /></div>;

  const me = user.id;
  const isOwner = d.ownerId === me;
  const isExec = d.executorId === me;
  const isArbiter = d.arbiterId === me;
  const isBackup = !!d.backupArbiterId && d.backupArbiterId === me;
  const myContribution = d.contributed[me] ?? 0;
  const chip = dealChip(d.summary);
  const paid = d.stages.filter((s) => s.status === "accepted").reduce((a, s) => a + s.amount, 0);
  /** запасной приемщик решает спор со второй половины срока на спор */
  const backupReady = (st: Stage) => isBackup && !!d.disputeMs && st.disputedAt !== undefined && now >= st.disputedAt + Math.floor(d.disputeMs / 2);
  const reservedLeft = Object.values(d.reserves).reduce((a, b) => a + b, 0);
  const raised = d.summary.raised;
  const crowd = d.mode === "crowdfunding";
  const draft = d.status === "draft";
  const canCancel =
    d.status !== "completed" && d.status !== "cancelled" &&
    (draft ? isExec || isOwner : crowd ? isExec : isOwner) &&
    !d.stages.some((s) => s.status === "submitted" || s.status === "disputed");

  async function run(path: string, body: unknown = {}, ok?: string): Promise<{ deal: DealFull } | null> {
    setBusy(true);
    try {
      const out = await api<{ deal: DealFull }>(`/deals/${id}${path}`, { method: "POST", body });
      if (ok) toast(ok);
      setAsk(null);
      setText("");
      setPhotos([]);
      setAmount("");
      await Promise.all([reload(), refresh()]);
      return out;
    } catch (e) {
      toast((e as Error).message, "err");
      return null;
    } finally {
      setBusy(false);
    }
  }

  /** Ключ этого устройства создается заранее, чтобы контракт подписывал сам пользователь, а не сервер. */
  async function prepareKey() {
    if (!deviceKeysAvailable()) return;
    try {
      await ensureDeviceKey(me);
    } catch {
      /* без ключа сервер подпишет демо-подписью, если это разрешено */
    }
  }
  /** Подпись контракта ключом устройства (или серверная демо-подпись, если ключи в браузере недоступны). */
  async function signNow(hash: string, okText?: string) {
    if (!deviceKeysAvailable()) return run("/sign", {}, okText);
    setBusy(true);
    let proof;
    try {
      proof = await signContractOnDevice(me, id, hash);
    } catch (e) {
      toast((e as Error).message || "Не удалось подписать на этом устройстве", "err");
      setBusy(false);
      return null;
    }
    setBusy(false);
    return run("/sign", { proof }, okText);
  }

  const sg = d.signatureStatus;
  const fullyReserved = reservedLeft >= d.target && d.target > 0;
  const needsMySign = d.status === "funding" && !!d.contract && sg.required.includes(me) && !sg.signed.includes(me);
  const unsigned = sg.required.filter((u) => !sg.signed.includes(u)).map((u) => d.people[u]?.name ?? "участник");
  const missing = d.target - Object.values(d.reserves).reduce((a, b) => a + b, 0);

  const expired = d.stages.some((x) => x.resolution?.by === "expired") || !!d.journal?.some((e) => e.type === "funding_expired");

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
          Исполнитель: {d.people[d.executorId]?.name}
          {d.ownerId && <> · {d.mode === "grant" ? "Грантодатель" : "Заказчик"}: {d.people[d.ownerId]?.name}</>}
        </div>
      </div>

      {!draft && <div className="hero compact">
        {paidBurst && <><i className="burst" /><i className="burst two" /></>}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="art" src={d.status === "completed" ? IMG.accept : d.status === "cancelled" ? (expired ? IMG.deadline : IMG.folder) : d.status === "active" ? IMG.steps : IMG.reserve} alt="" />
        <div className="label">Выплачено исполнителю</div>
        <div className="big"><Money value={paid} /></div>
        <div style={{ maxWidth: 190 }}>
          <SegBar onDark count={d.stages.length} filled={d.stages.filter((x) => x.status === "accepted").length} cur={d.status === "active" ? d.stages.filter((x) => x.status === "accepted").length : undefined} label="Принятые этапы" />
          <div className="small" style={{ marginTop: 8, opacity: 0.9 }}>из {rub(d.target)}</div>
        </div>
        {reservedLeft > 0 && <div className="pill" style={{ marginTop: 12 }}><Icon name="lock" size={15} /> {rub(reservedLeft)} в резерве</div>}
      </div>}

      {expired && (
        <div className="card feat">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="float" src={IMG.deadline} alt="" />
          <div>
            <div className="title">Срок вышел, деньги вернулись</div>
            <div className="small muted" style={{ marginTop: 4 }}>Сторона не уложилась в срок из контракта, остаток возвращен без чьего-либо согласия.</div>
          </div>
        </div>
      )}

      {(d.meta?.chatId || !draft || d.chain) && <div className="group">
        {d.meta?.chatId && (
          <Link href={`/chats/${d.meta.chatId}`} className="card tap row">
            <span className="setic"><Icon name="chat" size={20} /></span>
            <div className="grow title">Чат по задаче</div>
            <Icon name="arrow" size={18} />
          </Link>
        )}
        {!draft && <ContractCard d={d} />}
        {!draft && <JournalCard d={d} />}
        <ChainCard d={d} />
      </div>}
      {d.meta?.agreed ? <div className="card row between"><div className="small muted">Договорились на</div><b className="mono">{rub(d.meta.agreed)}</b></div> : null}
      {d.meta?.description && <div className="card"><div className="small muted">О чем договорились</div><div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{d.meta.description}</div></div>}

      {draft && isExec && (() => {
        const cur = rows ?? stagesToRows(d.stages.map((x) => ({ title: x.title, amount: x.amount, criteria: x.criteria })));
        const ready = rowsToStages(cur).length > 0;
        return (
          <div className="card stack">
            <div className="title">Условия для заказчика</div>
            <div className="sub">Разбейте работу на этапы и укажите стоимость каждого. Заказчик увидит их, проверит и зарезервирует деньги.</div>
            <StageEditor rows={cur} onChange={setRows} mode="own" seedText={[d.title, d.meta?.description].filter(Boolean).join(". ")} />
            <div className="btns">
              <button className="btn soft" disabled={busy || !ready} onClick={() => run("/terms", { stages: rowsToStages(cur) }, "Сохранено")}>Сохранить</button>
              <button className="btn" disabled={busy || !ready} onClick={async () => {
                if (!(await run("/terms", { stages: rowsToStages(cur) }))) return;
                await prepareKey();
                const r = await run("/propose", {}, `Условия на ${rub(toKopecks(rowsTotal(cur)))} отправлены заказчику`);
                if (r?.deal.contract && !r.deal.signatures?.[me]) await signNow(r.deal.contract.hash, "Контракт подписан");
              }}>Отправить</button>
            </div>
          </div>
        );
      })()}
      {draft && !isExec && (
        <div className="card row">
          <Icon name="clock" size={22} />
          <div className="sub">Исполнитель составляет этапы и стоимость. Когда отправит условия, вы сможете их проверить и зарезервировать деньги. Вопросы можно обсудить в чате.</div>
        </div>
      )}

      {needsMySign && !(isOwner && !crowd && !fullyReserved) && (
        <div className="card stack">
          <div className="title">Подпишите контракт</div>
          <div className="small muted">{fullyReserved ? "Деньги зарезервированы. Работа начнется, когда контракт подпишут все стороны." : "Подпись нужна до начала работы. Условия зафиксированы хешем, их уже нельзя изменить."}</div>
          <button className="btn" disabled={busy} onClick={() => signNow(d.contract!.hash, "Контракт подписан")}>Подписать контракт</button>
        </div>
      )}
      {d.status === "funding" && fullyReserved && !needsMySign && unsigned.length > 0 && (
        <div className="card row"><Icon name="clock" size={22} /><div className="sub">Деньги зарезервированы. Ждем подпись контракта: {unsigned.join(", ")}.</div></div>
      )}

      {d.status === "funding" && !fullyReserved && (
        <div className="card stack">
          {crowd ? (
            <>
              <div className="row between"><b>Собрано {rub(raised)}</b><span className="muted">из {rub(d.target)}</span></div>
              <SegBar count={d.stages.length} filled={d.target ? (raised / d.target) * d.stages.length : 0} label="Сбор средств по этапам" />
              <div className="small muted">Поддержали {d.summary.sponsors}. Не сдан этап: остаток вернется вам.</div>
              {!isExec && (
                <>
                  <div className="chips">
                    {[1000, 5000, 10000, 50000].filter((v) => toKopecks(v) <= missing).map((v) => (
                      <button key={v} className="opt" onClick={() => setAmount(String(v))}>{rub(toKopecks(v))}</button>
                    ))}
                    <button className="opt" onClick={() => setAmount(String(Math.floor(missing / 100)))}>Все недостающее</button>
                  </div>
                  <MoneyInput placeholder="Сумма, ₽" value={amount} onChange={setAmount} />
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
              <div className="small muted">Деньги замораживаются в кошельке и уходят исполнителю только за принятые этапы.</div>
              <button className="btn" disabled={busy || (wallet?.free ?? 0) < d.target} onClick={async () => {
                if (needsMySign) {
                  await prepareKey();
                  if (!(await signNow(d.contract!.hash))) return;
                }
                await run("/fund", {}, "Резерв создан");
              }}>
                <Icon name="lock" size={18} /> {needsMySign ? "Подписать и зарезервировать" : "Зарезервировать"}
              </button>
              {(wallet?.free ?? 0) < d.target && <div className="note warn">Не хватает {rub(d.target - (wallet?.free ?? 0))}. Пополните кошелек на вкладке «Кошелек».</div>}
            </>
          ) : (
            <>
              <div className="row"><Icon name="clock" size={22} /><div className="sub">Ждем, пока {d.mode === "grant" ? "грантодатель" : "заказчик"} зарезервирует деньги</div></div>
              {d.mode === "own" && isExec && <button className="btn ghost sm" disabled={busy} onClick={() => run("/reopen", {}, "Условия снова можно править")}>Изменить условия</button>}
            </>
          )}
        </div>
      )}

      {!draft && <div className="timeline">
        {d.stages.map((s, i) => {
          const left = s.submittedAt ? s.submittedAt + d.autoAcceptMs - now : 0;
          const votesAccept = Object.entries(s.votes).filter(([, v]) => v === "accept").reduce((a, [u]) => a + (d.contributed[u] ?? 0), 0);
          const voted = s.votes[me];
          return (
            <div key={s.id} className={`node ${s.status} ${changed.has(s.id) ? "just" : ""}`}>
              <div className="dot">{s.status === "accepted" ? <Icon name="check" size={18} /> : i + 1}</div>
              <div className={`body card ${s.status === "pending" || s.status === "accepted" ? "flat" : ""}`}>
                <div className="row between">
                  <div className="title">{s.title}</div>
                  <b className="mono">{rub(s.amount)}</b>
                </div>
                <div className="small muted" style={{ marginTop: 2 }}>{STAGE_LABEL[s.status]}</div>
                {s.criteria.length > 0 && <ul className="crit">{s.criteria.map((c) => <li key={c}>{c}</li>)}</ul>}
                {(!!s.evidence?.note || (s.evidence?.photos?.length ?? 0) > 0) && (
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
                        <div className="who">{d.people[m.by]?.name ?? "Участник"}{m.by === d.arbiterId ? " · приемщик" : ""}</div>
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
                    {d.mode !== "grant" && <div className="note warn"><Icon name="clock" size={14} /> Автоприемка через {timeLeft(left)}</div>}
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
                          <button className="btn green" disabled={busy} onClick={() => run(`/stages/${s.id}/vote`, { vote: "accept" }, "Голос учтен")}>Принять</button>
                          <button className="btn danger" disabled={busy} onClick={() => run(`/stages/${s.id}/vote`, { vote: "reject" }, "Голос учтен")}>Отклонить</button>
                        </div>
                      </>
                    )}
                    {d.mode === "own" && (isOwner || isExec) && (
                      <button className="btn ghost sm" onClick={() => { setAsk({ kind: "dispute", stage: s }); setText(""); }}>Открыть спор</button>
                    )}
                  </div>
                )}

                {s.status === "disputed" && (isOwner || isExec || isArbiter || isBackup) && (
                  <button className="btn soft" style={{ marginTop: 12 }} onClick={() => { setAsk({ kind: "reply", stage: s }); setText(""); setPhotos([]); }}>
                    <Icon name="camera" size={18} /> {isArbiter || isBackup ? "Задать вопрос сторонам" : "Ответить / добавить фото"}
                  </button>
                )}
                {s.status === "disputed" && isBackup && !backupReady(s) && (
                  <div className="note warn" style={{ marginTop: 10 }}>Вы запасной приемщик: решение откроется {dayLabel((s.disputedAt ?? 0) + Math.floor((d.disputeMs ?? 0) / 2))}, если основной приемщик не решит спор раньше</div>
                )}
                {s.status === "disputed" && (isArbiter || backupReady(s)) && (
                  <div className="btns" style={{ marginTop: 10 }}>
                    <button className="btn green" disabled={busy} onClick={() => { setAsk({ kind: "pay", stage: s }); setText(""); }}>Выплатить</button>
                    <button className="btn danger" disabled={busy} onClick={() => { setAsk({ kind: "refund", stage: s }); setText(""); }}>Вернуть</button>
                  </div>
                )}
                {s.status === "disputed" && !isArbiter && !isBackup && <div className="note warn" style={{ marginTop: 10 }}>Деньги за этап заморожены до решения независимого приемщика</div>}
              </div>
            </div>
          );
        })}
      </div>}

      {crowd && Object.keys(d.contributed).length > 0 && (
        <div className="card stack">
          <div className="title">Спонсоры</div>
          {Object.entries(d.contributed).map(([uid, v]) => (
            <div key={uid} className="row between"><span>{d.people[uid]?.name ?? "Участник"}</span><b className="mono">{rub(v)}</b></div>
          ))}
        </div>
      )}

      {canCancel && (
        <button className="btn danger" disabled={busy} onClick={() => confirm(draft ? "Отменить задачу?" : "Отменить сделку? Неиспользованный резерв вернется.") && run("/cancel", {}, draft ? "Задача отменена" : "Сделка отменена, остаток возвращен")}>
          {draft ? "Отменить задачу" : "Отменить сделку и вернуть остаток"}
        </button>
      )}

      {ask && (() => {
        const k = ask.kind;
        const title = { submit: `Сдать этап «${ask.stage.title}»`, reject: "Причина отказа", dispute: "Причина спора", reply: "Сообщение в споре", pay: "Выплатить исполнителю", refund: "Вернуть деньги заказчику" }[k];
        const needText = k === "reject" || k === "dispute";
        const hasPhotos = k === "submit" || k === "reply";
        const label = { submit: "Сдать на приемку", reject: "Отправить отказ", dispute: "Открыть спор", reply: "Отправить", pay: "Подтвердить выплату", refund: "Подтвердить возврат" }[k];
        const base = `/stages/${ask.stage.id}`;
        const go = () => {
          if (k === "submit") return run(`${base}/submit`, { note: text.trim() || undefined, photos }, "Этап сдан, ждем приемки");
          if (k === "reject") return run(`${base}/reject`, { reason: text }, d.mode === "grant" ? "Этап отклонен, остаток возвращен" : "Отказ отправлен, открыт спор");
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
