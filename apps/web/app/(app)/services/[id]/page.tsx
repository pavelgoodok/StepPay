"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { PhotoGrid } from "@/components/photos";
import { Ava, Icon } from "@/components/ui";
import { api, type ServiceItem } from "@/lib/api";
import { rub } from "@/lib/format";
import { useSession, usePoll } from "@/lib/session";

export default function ServicePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useSession();
  const { data: s, error } = usePoll(() => api<ServiceItem>(`/services/${id}`), [id]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  if (error && !s) return <div className="page"><Link href="/catalog" className="btn ghost sm"><Icon name="back" size={18} /> Каталог</Link><div className="note bad">{error}</div></div>;
  if (!s) return <div className="page"><div className="skeleton" /></div>;

  async function write() {
    setBusy(true);
    try {
      const r = await api<{ id: string }>(`/services/${id}/chat`, { method: "POST", body: { text: text.trim() || undefined } });
      router.push(`/chats/${r.id}`);
    } catch (e) {
      toast((e as Error).message, "err");
      setBusy(false);
    }
  }

  async function hide() {
    if (!confirm("Скрыть услугу из каталога? Чаты и сделки по ней останутся.")) return;
    try {
      await api(`/services/${id}/remove`, { method: "POST", body: {} });
      toast("Услуга скрыта");
      router.replace("/catalog");
    } catch (e) {
      toast((e as Error).message, "err");
    }
  }

  return (
    <div className="page">
      <Link href="/catalog" className="btn ghost sm" style={{ paddingLeft: 0, alignSelf: "flex-start" }}><Icon name="back" size={18} /> Каталог</Link>
      <div>
        <div className="small muted">{s.category}</div>
        <h1 className="h1" style={{ fontSize: 28 }}>{s.title}</h1>
      </div>
      <div className="row">
        <Ava name={s.owner.name} src={s.owner.avatar} />
        <div className="grow"><b>{s.owner.name}</b><div className="small muted">Исполнитель</div></div>
        {s.priceFrom ? <b className="mono">от {rub(s.priceFrom)}</b> : null}
      </div>
      <div className="card stack">
        <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{s.description}</p>
        <PhotoGrid photos={s.photos} />
      </div>
      {s.mine ? (
        <div className="btns">
          <Link href={`/services/${id}/edit`} className="btn soft">Изменить</Link>
          {s.active && <button className="btn danger" onClick={hide}>Скрыть</button>}
        </div>
      ) : (
        <div className="card stack">
          <div className="title">Обсудить задачу</div>
          <div className="sub">Опишите, что нужно сделать. Детали уточните в чате: когда договоритесь, исполнитель зарегистрирует задачу и разобьет ее на этапы.</div>
          <textarea className="input" placeholder="Здравствуйте! Нужно…" value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn" disabled={busy} onClick={write}>Написать исполнителю</button>
        </div>
      )}
    </div>
  );
}
