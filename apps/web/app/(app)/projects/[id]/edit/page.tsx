"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AuthorForm, FnsBadge } from "@/components/author-form";
import { CropSheet } from "@/components/cropper";
import { PhotoPicker } from "@/components/photos";
import { StageEditor, emptyRow, rowsToStages, rowsTotal, stagesToRows, type Row } from "@/components/stage-editor";
import { IMG, Icon, SegBar } from "@/components/ui";
import { api, openDoc, photoSrc, uploadDataUrl, uploadDoc, type AuthorProfile, type ProjectDoc, type ProjectFull } from "@/lib/api";
import { rub, toKopecks } from "@/lib/format";
import { KIND_LABEL, LEGAL_LABEL } from "@/lib/labels";
import { useSession } from "@/lib/session";

const CATS = ["Игры", "Музыка и творчество", "Технологии", "Образование", "Городская среда", "Социальные проекты", "Другое"];
const STEPS = ["Об авторе", "О проекте", "Этапы и суммы", "Материалы", "Проверка"];
const COVER = "Обложка";

export default function EditProject() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useSession();
  const [p, setP] = useState<ProjectFull | null>(null);
  const [author, setAuthor] = useState<AuthorProfile | null | undefined>(undefined);
  const [editAuthor, setEditAuthor] = useState(false);
  const [step, setStep] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Другое");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [docs, setDocs] = useState<ProjectDoc[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);

  const valid = (docsNow = docs) => [
    !!author,
    title.trim().length >= 3 && summary.trim().length >= 20 && description.trim().length >= 100,
    rowsToStages(rows).length > 0,
    docsNow.some((d) => d.kind === "photo") && docsNow.some((d) => d.kind === "doc"),
  ];

  useEffect(() => {
    Promise.all([api<ProjectFull>(`/projects/${id}`), api<AuthorProfile | null>("/me/author").catch(() => null)])
      .then(([x, a]) => {
        setP(x);
        setAuthor(a);
        setTitle(x.title);
        setCategory(x.category);
        setSummary(x.summary);
        setDescription(x.description);
        setRows(stagesToRows(x.stages));
        setDocs(x.docs ?? []);
        const ok = [
          !!a,
          x.title.trim().length >= 3 && x.summary.trim().length >= 20 && x.description.trim().length >= 100,
          x.stages.length > 0,
          (x.docs ?? []).some((d) => d.kind === "photo") && (x.docs ?? []).some((d) => d.kind === "doc"),
        ];
        const first = ok.findIndex((v) => !v);
        setStep(first === -1 ? 4 : first);
      })
      .catch((e: Error) => setErr(e.message));
  }, [id]);

  if (err) return <div className="page"><Link href="/catalog" className="btn ghost sm"><Icon name="back" size={18} /> Назад</Link><div className="note bad">{err}</div></div>;
  if (!p || author === undefined || step === null) return <div className="page"><div className="skeleton" /><div className="skeleton" /></div>;
  if (!p.can.edit) {
    return <div className="page"><Link href={`/projects/${id}`} className="btn ghost sm"><Icon name="back" size={18} /> Назад</Link><div className="note">Проект на проверке или уже рассмотрен, править его нельзя.</div></div>;
  }

  const cover = docs.find((d) => d.kind === "photo" && d.name === COVER);
  const photos = docs.filter((d) => d.kind === "photo" && d.name !== COVER);
  const files = docs.filter((d) => d.kind === "doc");
  const lastNote = [...(p.history ?? [])].reverse().find((h) => h.comment);
  const ok = valid();
  const total = rowsTotal(rows);

  const body = () => ({ title: title.trim(), category, summary: summary.trim(), description: description.trim(), stages: rowsToStages(rows), docs });
  async function save(quiet = false) {
    const next = await api<ProjectFull>(`/projects/${id}/update`, { method: "POST", body: body() });
    setP(next);
    if (!quiet) toast("Сохранено");
  }
  async function wrap(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  }
  const go = (n: number) => wrap(async () => {
    if (step! >= 1 && n > step!) await save(true);
    setStep(n);
    window.scrollTo({ top: 0 });
  });
  const submit = () =>
    wrap(async () => {
      await save(true);
      await api(`/projects/${id}/submit`, { method: "POST", body: {} });
      toast("Проект отправлен на проверку");
      router.replace(`/projects/${id}`);
    });

  async function addDoc(f: File | undefined) {
    if (!f) return;
    await wrap(async () => {
      try {
        const url = await uploadDoc(f);
        setDocs((d) => [...d, { id: Math.random().toString(36).slice(2, 10), name: f.name.slice(0, 100), url, kind: "doc" }]);
      } finally {
        if (file.current) file.current.value = "";
      }
    });
  }
  async function saveCover(dataUrl: string) {
    setCropFile(null);
    await wrap(async () => {
      const url = await uploadDataUrl(dataUrl);
      setDocs((d) => [{ id: "cover", name: COVER, url, kind: "photo" }, ...d.filter((x) => x.name !== COVER)]);
    });
  }

  const nextOk = step === 0 ? ok[0] : step === 1 ? ok[1] : step === 2 ? ok[2] : step === 3 ? ok[3] : false;
  const hint =
    step === 1 && !ok[1]
      ? `Нужно название, короткое описание от 20 символов и подробное от 100 (сейчас ${description.trim().length})`
      : step === 2 && !ok[2]
        ? "Добавьте хотя бы один этап с названием и суммой"
        : step === 3 && !ok[3]
          ? "Нужна обложка или фото и документ с подтверждением"
          : null;

  return (
    <div className="page">
      <Link href="/catalog" className="btn ghost sm" style={{ paddingLeft: 0, alignSelf: "flex-start" }}><Icon name="back" size={18} /> Назад</Link>
      <div className="stack" style={{ gap: 10 }}>
        <div className="small muted">{KIND_LABEL[p.kind]} · заявка на проверку</div>
        <SegBar count={STEPS.length} filled={step + 1} label={`Шаг ${step + 1} из ${STEPS.length}`} />
        <h1 className="h1">{STEPS[step]}</h1>
      </div>

      {p.status === "changes" && lastNote && (
        <div className="note warn" style={{ marginTop: 0 }}><b>Замечания администратора</b><div style={{ marginTop: 4 }}>{lastNote.comment}</div></div>
      )}

      {step === 0 && (
        <div className="card stack">
          <div className="sub">Нужна один раз: администратор проверит, кто стоит за проектом. Данные видны только вам и администраторам.</div>
          {author && !editAuthor ? (
            <div className="stack">
              <div className="row between">
                <div className="sub">
                  {LEGAL_LABEL[author.legalStatus]}{author.orgName ? `, ${author.orgName}` : ""}<br />ИНН {author.inn}{author.email ? ` · ${author.email}` : ""}
                </div>
                <button className="btn ghost sm" onClick={() => setEditAuthor(true)}>Изменить</button>
              </div>
              <FnsBadge fns={author.fns} />
            </div>
          ) : (
            <AuthorForm initial={author} onSaved={(a) => { setAuthor(a); setEditAuthor(false); }} />
          )}
        </div>
      )}

      {step === 1 && (
        <div className="card stack">
          <div className="field"><label>Название</label><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div className="field">
            <label>Категория</label>
            <div className="chips">{CATS.map((c) => <button key={c} className={`opt ${category === c ? "on" : ""}`} onClick={() => setCategory(c)}>{c}</button>)}</div>
          </div>
          <div className="field"><label>Коротко, в одной фразе</label><input className="input" value={summary} maxLength={200} onChange={(e) => setSummary(e.target.value)} /></div>
          <div className="field">
            <label>Подробно: что делаете, для кого и на что пойдут деньги</label>
            <textarea className="input" style={{ minHeight: 160 }} value={description} onChange={(e) => setDescription(e.target.value)} />
            <span className="small muted">{description.trim().length} из 100 символов минимум</span>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="card stack">
          <div className="sub">{p.kind === "grant" ? "Грантодатель переведет всю сумму сразу, а вы получите деньги по мере принятия этапов." : "Поддержавшие получают отчет по каждому этапу, деньги выплачиваются после принятия."}</div>
          <StageEditor rows={rows} onChange={setRows} mode={p.kind} seedText={summary} />
        </div>
      )}

      {step === 3 && (
        <div className="stack">
          <div className="card stack">
            <div className="title">Обложка</div>
            <div className="sub">Главная картинка в каталоге. Подвигайте и приблизьте фото так, как оно должно выглядеть.</div>
            {cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="pcover" src={photoSrc(cover.url)} alt="Обложка проекта" />
            ) : (
              <div className="pcover none tone3 emptycover" style={{ aspectRatio: "16 / 9", color: "var(--muted)" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="float" src={p.kind === "grant" ? IMG.sprout : IMG.rocket} alt="" />
                <span>Обложка не выбрана</span>
              </div>
            )}
            <div className="btns">
              <button className="btn soft" disabled={busy} onClick={() => coverInput.current?.click()}>{cover ? "Заменить" : "Выбрать фото"}</button>
              {cover && <button className="btn ghost" onClick={() => setDocs(docs.filter((d) => d.name !== COVER))}>Убрать</button>}
            </div>
            <input ref={coverInput} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setCropFile(f); if (coverInput.current) coverInput.current.value = ""; }} />
          </div>
          <div className="card stack">
            <div className="title">Фото проекта</div>
            <PhotoPicker value={photos.map((d) => d.url)} max={6} onChange={(urls) => setDocs([...docs.filter((d) => d.kind === "doc" || d.name === COVER), ...urls.map((u, i) => photos.find((x) => x.url === u) ?? { id: `ph${Date.now()}${i}`, name: "Фото", url: u, kind: "photo" as const })])} />
          </div>
          <div className="card stack">
            <div className="title">Документы</div>
            <div className="sub">Смета, план или договор в PDF до 5 МБ. Видны только вам и администраторам.</div>
            {files.map((f) => (
              <div key={f.id} className="picked">
                <Icon name="check" size={18} />
                <button className="grow ellipsis" style={{ textAlign: "left" }} onClick={() => void openDoc(f.url).catch((e: Error) => toast(e.message, "err"))}>{f.name}</button>
                <button className="iconbtn" aria-label="Убрать" onClick={() => setDocs(docs.filter((x) => x.id !== f.id))}><Icon name="x" size={16} /></button>
              </div>
            ))}
            <button className="btn soft sm" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={() => file.current?.click()}>Добавить документ</button>
            <input ref={file} type="file" accept="application/pdf" hidden onChange={(e) => void addDoc(e.target.files?.[0])} />
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="stack">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="pcover" src={photoSrc(cover.url)} alt="" />
          ) : null}
          <div className="card stack">
            <div className="small muted">{p.category}</div>
            <div className="title">{title || "Без названия"}</div>
            <div className="sub">{summary}</div>
            <div className="row between"><span>Сумма проекта</span><b className="mono">{rub(toKopecks(total))}</b></div>
          </div>
          <div className="group">
            {STEPS.slice(0, 4).map((name, i) => (
              <button key={name} className="card tap row" style={{ textAlign: "left", width: "100%" }} onClick={() => setStep(i)}>
                <span className="setic"><Icon name={ok[i] ? "check" : "clock"} size={20} /></span>
                <div className="grow"><div className="title">{name}</div><div className="small muted">{ok[i] ? "Готово" : "Нужно заполнить"}</div></div>
                <Icon name="arrow" size={18} />
              </button>
            ))}
          </div>
          <div className="small muted">После отправки проект нельзя править, пока администратор не вернет его на доработку.</div>
        </div>
      )}

      {hint && <div className="small" style={{ color: "var(--amber)" }}>{hint}</div>}

      <div className="btns">
        {step > 0 && <button className="btn soft" disabled={busy} onClick={() => void go(step - 1)}>Назад</button>}
        {step < 4 ? (
          <button className="btn" disabled={busy || !nextOk} onClick={() => void go(step + 1)}>Далее</button>
        ) : (
          <button className="btn" disabled={busy || !ok.every(Boolean)} onClick={submit}>Отправить на проверку</button>
        )}
      </div>

      {cropFile && <CropSheet file={cropFile} aspect={16 / 9} outWidth={1280} title="Обложка проекта" onDone={(u) => void saveCover(u)} onClose={() => setCropFile(null)} />}
    </div>
  );
}
