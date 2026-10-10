"use client";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Initials, Logo } from "@/components/ui";
import { api, type Role } from "@/lib/api";
import { rub } from "@/lib/format";

interface Pub {
  id: string;
  name: string;
  role: Role;
  acceptedStages: number;
  failedStages: number;
  disputes: number;
  autoAccepted: number;
  dealsCompleted: number;
  received: number;
  rating: number | null;
}
const ROLE: Record<string, string> = { customer: "Заказчик", executor: "Исполнитель", sponsor: "Спонсор", funder: "Грантодатель", arbiter: "Приёмщик споров" };

export default function PublicCard() {
  const { id } = useParams<{ id: string }>();
  const [p, setP] = useState<Pub | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    api<Pub>(`/users/${id}/public`).then(setP).catch((e: Error) => setErr(e.message));
  }, [id]);

  async function share() {
    const url = location.href;
    try {
      if (navigator.share) await navigator.share({ title: `${p?.name} на StepPay`, url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      /* пользователь закрыл меню «Поделиться» */
    }
  }

  return (
    <div className="shell">
      <div className="page">
        <div className="top"><Logo /></div>
        {err && <div className="note bad">{err}</div>}
        {!p && !err && <div className="skeleton" />}
        {p && (
          <>
            <div className="hero" style={{ textAlign: "center", paddingTop: 28 }}>
              <div style={{ display: "grid", placeItems: "center" }}><Initials name={p.name} /></div>
              <div className="big" style={{ fontSize: 26, margin: "10px 0 2px" }}>{p.name}</div>
              <div className="label">{ROLE[p.role]} на StepPay</div>
              {p.rating !== null ? (
                <div style={{ marginTop: 14 }}>
                  <span className="stars" aria-hidden>{"★".repeat(Math.round(p.rating))}{"☆".repeat(5 - Math.round(p.rating))}</span>
                  <div style={{ fontSize: 30, fontWeight: 800 }}>{p.rating.toFixed(1).replace(".", ",")}</div>
                </div>
              ) : (
                <div className="pill" style={{ marginTop: 14 }}>Пока нет закрытых этапов</div>
              )}
            </div>
            <div className="card row" style={{ justifyContent: "space-around", textAlign: "center" }}>
              <div><div className="h1">{p.acceptedStages}</div><div className="small muted">принято этапов</div></div>
              <div><div className="h1">{p.dealsCompleted}</div><div className="small muted">сделок завершено</div></div>
              <div><div className="h1">{p.disputes}</div><div className="small muted">споров</div></div>
            </div>
            <div className="card stack" style={{ gap: 8 }}>
              <div className="row between"><span className="muted">Получено через StepPay</span><b className="mono">{rub(p.received)}</b></div>
              <div className="row between"><span className="muted">Принято автоматически</span><b>{p.autoAccepted}</b></div>
              <div className="row between"><span className="muted">Не принято этапов</span><b>{p.failedStages}</b></div>
            </div>
            <p className="small muted">Рейтинг считается только по этапам, закрытым в сервисе: чем больше принятых и чем меньше проваленных, тем выше оценка. Отзывы написать нельзя — рейтинг нельзя накрутить.</p>
            <button className="btn" onClick={share}>{copied ? "Ссылка скопирована" : "Поделиться карточкой"}</button>
          </>
        )}
      </div>
    </div>
  );
}
