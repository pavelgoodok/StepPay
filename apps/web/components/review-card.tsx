"use client";
import { useState } from "react";
import { Ava } from "./ui";
import { Stars } from "./stars";
import { api, type DealReviews } from "@/lib/api";
import { dayLabel } from "@/lib/format";
import { useSession, usePoll } from "@/lib/session";

const HINT: Record<number, string> = { 1: "Очень плохо", 2: "Плохо", 3: "Нормально", 4: "Хорошо", 5: "Отлично" };

/** Отзыв по завершенной сделке: оценка 1-5 и комментарий. Низкая оценка требует пояснения. */
export function ReviewCard({ dealId, collapsible }: { dealId: string; collapsible?: boolean }) {
  const { user, toast, refresh } = useSession();
  const { data, reload } = usePoll(() => api<DealReviews>(`/reviews/of/${dealId}`), [dealId], 20_000);
  const [stars, setStars] = useState(0);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  if (!data) return null;
  if (!data.canReview && data.items.length === 0) return null;

  async function send() {
    setBusy(true);
    try {
      await api(`/reviews/of/${dealId}`, { method: "POST", body: { stars, text } });
      toast("Отзыв сохранен");
      await Promise.all([reload(), refresh()]);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  }

  const low = stars > 0 && stars <= 2;
  if (collapsible && data.canReview && data.target && !open && data.items.length === 0) {
    return <button className="btn soft" onClick={() => setOpen(true)}>Оценить: {data.target.name}</button>;
  }
  return (
    <div className="card stack">
      {data.canReview && data.target && (
        <>
          <div className="row">
            <Ava name={data.target.name} src={data.target.avatar} size="sm" />
            <div className="grow"><div className="title">Оцените работу: {data.target.name}</div><div className="small muted">Отзыв влияет на рейтинг и виден другим участникам</div></div>
          </div>
          <div className="row"><Stars value={stars} onChange={setStars} size={34} /><span className="small muted">{stars ? HINT[stars] : "Выберите оценку"}</span></div>
          <textarea className="input" placeholder={low ? "Что пошло не так (обязательно)" : "Комментарий (необязательно)"} value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn" disabled={busy || !stars || (low && text.trim().length < 10)} onClick={send}>Оставить отзыв</button>
        </>
      )}
      {data.items.map((r) => (
        <div key={r.id} className="stack" style={{ gap: 4 }}>
          <div className="row between"><b>{r.from.id === user?.id ? "Ваш отзыв" : `Отзыв от ${r.from.name}`}</b><span className="small muted">{dayLabel(r.at)}</span></div>
          <Stars value={r.stars} />
          {r.text && <div style={{ whiteSpace: "pre-wrap" }}>{r.text}</div>}
        </div>
      ))}
    </div>
  );
}
