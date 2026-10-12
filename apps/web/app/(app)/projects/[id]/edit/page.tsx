"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AuthorForm } from "@/components/author-form";
import { PhotoPicker } from "@/components/photos";
import { StageEditor, emptyRow, rowsToStages, stagesToRows, type Row } from "@/components/stage-editor";
import { Icon } from "@/components/ui";
import { api, docSrc, uploadDoc, type AuthorProfile, type ProjectDoc, type ProjectFull } from "@/lib/api";
import { LEGAL_LABEL, KIND_LABEL } from "@/lib/labels";
import { useSession } from "@/lib/session";

const CATS = ["Игры", "Музыка и творчество", "Технологии", "Образование", "Городская среда", "Социальные проекты", "Другое"];

export default function EditProject() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useSession();
  const [p, setP] = useState<ProjectFull | null>(null);
  const [author, setAuthor] = useState<AuthorProfile | null | undefined>(undefined);
  const [editAuthor, setEditAuthor] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Другое");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [docs, setDocs] = useState<ProjectDoc[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<ProjectFull>(`/projects/${id}`).then((x) => {
      setP(x);
      setTitle(x.title);
      setCategory(x.category);
      setSummary(x.summary);
      setDescription(x.description);
      setRows(stagesToRows(x.stages));
      setDocs(x.docs ?? []);
    }).catch((e: Error) => setErr(e.message));
    api<AuthorProfile | null>("/me/author").then(setAuthor).catch(() => setAuthor(null));
  }, [id]);

  if (err) return <div className="page"><Link href="/catalog" className="btn ghost sm"><Icon name="back" size={18} /> Назад</Link><div className="note bad">{err}</div></div>;
  if (!p || author === undefined) return <div className="page"><div className="skeleton" /><div className="skeleton" /></div>;
  if (!p.can.edit) {
    return <div className="page"><Link href={`/projects/${id}`} className="btn ghost sm"><Icon name="back" size={18} /> Назад</Link><div className="note">Проект на проверке или уже рассмотрен, править его нельзя.</div></div>;
  }

  const photos = docs.filter((d) => d.kind === "photo");
  const files = docs.filter((d) => d.kind === "doc");
  const lastNote = [...(p.history ?? [])].reverse().find((h) => h.comment);

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

  
  return (
    <div className="page">
      <Link href="/catalog" className="btn ghost sm" style={{ paddingLeft: 0, alignSelf: "flex-start" }}><Icon name="back" size={18} /> Назад</Link>
      <div>
        <div className="small muted">{KIND_LABEL[p.kind]}</div>
        <h1 className="h1">Заявка на проверку</h1>
      </div>

      {p.status === "changes" && lastNote && (
        <div className="note warn" style={{ marginTop: 0 }}><b>Замечания администратора</b><div style={{ marginTop: 4 }}>{lastNote.comment}</div></div>
      )}

      <div className="card stack">
        <div className="row between">
          <div className="title">1. Об авторе</div>
          {author && !editAuthor && <button className="btn ghost sm" onClick={() => setEditAuthor(true)}>Изменить</button>}
        </div>
        {author && !editAuthor ? (
          <div className="sub">
            {LEGAL_LABEL[author.legalStatus]}{author.orgName ? `, ${author.orgName}` : ""}<br />ИНН {author.inn}{author.email ? ` · ${author.email}` : ""}
          </div>
        ) : (
          <AuthorForm initial={author} onSaved={(a) => { setAuthor(a); setEditAuthor(false); }} />
        )}
      </div>

      <div className="card stack">
        <div className="title">2. О проекте</div>
        <div className="field"><label>Название</label><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="field">
          <label>Категория</label>
          <div className="chips">{CATS.map((c) => <button key={c} className={`opt ${category === c ? "on" : ""}`} onClick={() => setCategory(c)}>{c}</button>)}</div>
        </div>
        <div className="field"><label>Коротко, в одной фразе</label><input className="input" value={summary} maxLength={200} onChange={(e) => setSummary(e.target.value)} /></div>
        <div className="field">
          <label>Подробно: что делаете, для кого и на что пойдут деньги</label>
          <textarea className="input" style={{ minHeight: 150 }} value={description} onChange={(e) => setDescription(e.target.value)} />
          <span className="small muted">{description.trim().length} из 100 символов минимум</span>
        </div>
      </div>

      <div className="card stack">
        <div className="title">3. Этапы и суммы</div>
        <div className="sub">{p.kind === "grant" ? "Грантодатель переведет всю сумму сразу, а вы получите деньги по мере принятия этапов." : "Поддержавшие получают отчет по каждому этапу, деньги выплачиваются после принятия."}</div>
        <StageEditor rows={rows} onChange={setRows} mode={p.kind} seedText={summary} />
      </div>

      <div className="card stack">
        <div className="title">4. Фото и документы</div>
        <div className="field"><label>Фото проекта</label>
          <PhotoPicker value={photos.map((d) => d.url)} max={6} onChange={(urls) => setDocs([...docs.filter((d) => d.kind === "doc"), ...urls.map((u, i) => photos.find((x) => x.url === u) ?? { id: `ph${Date.now()}${i}`, name: "Фото", url: u, kind: "photo" as const })])} />
        </div>
        <div className="field">
          <label>Смета, план или договор (PDF до 5 МБ)</label>
          {files.map((f) => (
            <div key={f.id} className="picked">
              <Icon name="check" size={18} />
              <a className="grow ellipsis" href={docSrc(f.url)} target="_blank" rel="noreferrer">{f.name}</a>
              <button className="iconbtn" aria-label="Убрать" onClick={() => setDocs(docs.filter((x) => x.id !== f.id))}><Icon name="x" size={16} /></button>
            </div>
          ))}
          <button className="btn soft sm" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={() => file.current?.click()}>Добавить документ</button>
          <input ref={file} type="file" accept="application/pdf" hidden onChange={(e) => void addDoc(e.target.files?.[0])} />
          <span className="small muted">Документы видны только вам и администраторам.</span>
        </div>
      </div>

      {p.problems && p.problems.length > 0 && (
        <div className="note warn" style={{ marginTop: 0 }}>
          <b>Перед отправкой</b>
          <ul className="crit" style={{ marginBottom: 0 }}>{p.problems.map((x) => <li key={x}>{x}</li>)}</ul>
          <div className="small" style={{ marginTop: 6 }}>Список обновляется после сохранения.</div>
        </div>
      )}

      <div className="btns">
        <button className="btn soft" disabled={busy} onClick={() => wrap(() => save())}>Сохранить</button>
        <button className="btn" disabled={busy || !author} onClick={submit}>На проверку</button>
      </div>
    </div>
  );
}

