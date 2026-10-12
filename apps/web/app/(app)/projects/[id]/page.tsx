"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { PhotoGrid } from "@/components/photos";
import { Ava, Icon, SegBar } from "@/components/ui";
import { api, docSrc, photoSrc, type ProjectFull } from "@/lib/api";
import { dayLabel, rub } from "@/lib/format";
import { KIND_LABEL, LEGAL_LABEL, PROJECT_STATUS } from "@/lib/labels";
import { useSession, usePoll } from "@/lib/session";

const ACTION: Record<string, string> = { submit: "Отправлен на проверку", resubmit: "Отправлен повторно", approve: "Одобрен", reject: "Отклонен", changes: "Возвращен на доработку" };

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, toast, refresh } = useSession();
  const { data: p, error } = usePoll(() => api<ProjectFull>(`/projects/${id}`), [id]);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  if (error && !p) return <div className="page"><Link href="/catalog" className="btn ghost sm"><Icon name="back" size={18} /> Каталог</Link><div className="note bad">{error}</div></div>;
  if (!p || !user) return <div className="page"><div className="skeleton" /><div className="skeleton" /></div>;

  const admin = user.role === "admin";
  const mine = p.owner.id === user.id;
  const st = PROJECT_STATUS[p.status]!;

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  }
  const decide = (action: "approve" | "changes" | "reject") =>
    act(async () => {
      await api(`/admin/projects/${id}/decision`, { method: "POST", body: { action, comment: comment.trim() || undefined } });
      toast(action === "approve" ? "Проект опубликован" : "Решение отправлено автору");
      router.replace("/admin");
    });
  const fundGrant = () =>
    act(async () => {
      if (!confirm(`Профинансировать грант на ${rub(p.goal)}? Сумма будет зарезервирована сразу.`)) return;
      const r = await api<{ dealId: string }>(`/projects/${id}/grant`, { method: "POST", body: {} });
      await refresh();
      router.push(`/deals/${r.dealId}`);
    });

  return (
    <div className="page">
      <div className="row between">
        <Link href={admin ? "/admin" : "/catalog"} className="btn ghost sm" style={{ paddingLeft: 0 }}><Icon name="back" size={18} /> {admin ? "Проверка" : "Каталог"}</Link>
        {(mine || admin) && <span className={`chip ${st.tone}`}>{st.text}</span>}
      </div>

      <div>
        <div className="small muted">{KIND_LABEL[p.kind]} · {p.category}</div>
        <h1 className="h1" style={{ fontSize: 28 }}>{p.title || "Без названия"}</h1>
        {p.summary && <div className="sub" style={{ marginTop: 4 }}>{p.summary}</div>}
      </div>

      {p.cover && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="pcover" src={photoSrc(p.cover)} alt="" />
      )}
      <PhotoGrid photos={p.photos.map((x) => x.url).filter((u) => u !== p.cover)} />

      <div className="row">
        <Ava name={p.owner.name} src={p.owner.avatar} />
        <div className="grow"><b>{p.owner.name}</b><div className="small muted">Автор проекта</div></div>
      </div>

      {p.dealId && p.kind === "crowdfunding" ? (
        <div className="card stack">
          <div className="dc-money"><b className="mono" style={{ fontSize: 24 }}>{rub(p.raised)}</b><span>из {rub(p.goal)}</span></div>
          <SegBar count={p.stageCount} filled={p.goal ? (p.raised / p.goal) * p.stageCount : 0} label="Сбор средств по этапам" />
          <div className="small muted">{p.sponsors} поддержали. Автор получает деньги только за принятые этапы.</div>
          <Link href={`/deals/${p.dealId}`} className="btn">{mine ? "Открыть сбор" : "Поддержать"}</Link>
        </div>
      ) : (
        <div className="card stack">
          <div className="dc-money"><b className="mono" style={{ fontSize: 24 }}>{rub(p.goal)}</b><span>{p.dealId ? "грант выдан" : "нужно на проект"}</span></div>
          {p.funder && <div className="sub">Грантодатель: {p.funder.name}</div>}
          {p.can.fundGrant && <button className="btn" disabled={busy} onClick={fundGrant}>Профинансировать грант</button>}
          {p.dealId && <Link href={`/deals/${p.dealId}`} className="btn soft">Открыть сделку</Link>}
        </div>
      )}

      {p.description && (
        <div className="card stack">
          <div className="title">О проекте</div>
          <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{p.description}</p>
        </div>
      )}

      <div className="card stack">
        <div className="title">Этапы</div>
        {p.stages.map((s, i) => (
          <div key={i}>
            <div className="row between"><span>{i + 1}. {s.title}</span><b className="mono">{rub(s.amount)}</b></div>
            {s.criteria.length > 0 && <ul className="crit">{s.criteria.map((c) => <li key={c}>{c}</li>)}</ul>}
          </div>
        ))}
      </div>

      {(mine || admin) && p.author && (
        <div className="card stack">
          <div className="title">Автор</div>
          <div className="sub">{LEGAL_LABEL[p.author.legalStatus]}{p.author.orgName ? `, ${p.author.orgName}` : ""}<br />ИНН {p.author.inn}{p.author.email ? ` · ${p.author.email}` : ""}</div>
        </div>
      )}

      {(mine || admin) && p.docs && p.docs.some((d) => d.kind === "doc") && (
        <div className="card stack">
          <div className="title">Документы</div>
          {p.docs.filter((d) => d.kind === "doc").map((d) => (
            <a key={d.id} className="picked" href={docSrc(d.url)} target="_blank" rel="noreferrer"><Icon name="check" size={18} /><span className="grow ellipsis">{d.name}</span><Icon name="arrow" size={16} /></a>
          ))}
        </div>
      )}

      {(mine || admin) && p.history && p.history.length > 0 && (
        <div className="card stack">
          <div className="title">История проверки</div>
          {[...p.history].reverse().map((h, i) => (
            <div key={i}>
              <div className="row between"><b>{ACTION[h.action]}</b><span className="small muted">{dayLabel(h.at)}</span></div>
              {h.comment && <div className="sub" style={{ marginTop: 2 }}>{h.comment}</div>}
            </div>
          ))}
        </div>
      )}

      {p.can.edit && <Link href={`/projects/${id}/edit`} className="btn">{p.status === "changes" ? "Исправить и отправить снова" : "Продолжить заполнение"}</Link>}

      {admin && p.status === "review" && (
        <div className="card stack">
          <div className="title">Решение</div>
          <textarea className="input" placeholder="Комментарий автору (обязателен для отказа и правок)" value={comment} onChange={(e) => setComment(e.target.value)} />
          <button className="btn green" disabled={busy} onClick={() => decide("approve")}>Одобрить и опубликовать</button>
          <div className="btns">
            <button className="btn soft" disabled={busy || !comment.trim()} onClick={() => decide("changes")}>На доработку</button>
            <button className="btn danger" disabled={busy || !comment.trim()} onClick={() => decide("reject")}>Отклонить</button>
          </div>
        </div>
      )}
    </div>
  );
}
