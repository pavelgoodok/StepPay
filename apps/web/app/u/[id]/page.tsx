"use client";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Ava, Icon, Logo } from "@/components/ui";
import { api, type Role } from "@/lib/api";
import { rub } from "@/lib/format";

interface Pub {
  id: string;
  name: string;
  role: Role;
  about: string;
  acceptedStages: number;
  failedStages: number;
  disputes: number;
  autoAccepted: number;
  dealsCompleted: number;
  received: number;
  rating: number | null;
}
const ROLE: Record<string, string> = { customer: "Заказчик", executor: "Исполнитель", sponsor: "Спонсор", funder: "Грантодатель", arbiter: "Приемщик споров", user: "Участник StepPay" };

/** Кольцо рейтинга: заполненная доля = оценка из пяти */
function Ring({ value }: { value: number | null }) {
  const r = 58;
  const c = 2 * Math.PI * r;
  const frac = value === null ? 0 : value / 5;
  return (
    <div className="ring">
      <svg viewBox="0 0 132 132" aria-hidden>
        <circle cx="66" cy="66" r={r} fill="none" stroke="var(--sh-d)" strokeOpacity=".35" strokeWidth="10" />
        {frac > 0 && <circle cx="66" cy="66" r={r} fill="none" stroke="var(--blue)" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${c * frac} ${c}`} />}
      </svg>
      <div className="num">
        {value === null ? "-" : value.toFixed(1).replace(".", ",")}
        <small>РЕЙТИНГ</small>
      </div>
    </div>
  );
}

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
      /* окно «Поделиться» закрыли */
    }
  }

  const verified = !!p && p.acceptedStages >= 3 && (p.rating ?? 0) >= 4.5;

  return (
    <div className="shell" style={{ paddingBottom: 40 }}>
      <div className="page" style={{ maxWidth: 520, margin: "0 auto" }}>
        <div className="top"><Logo /><span className="eyebrow">Публичная карточка</span></div>
        {err && <div className="note bad">{err}</div>}
        {!p && !err && <div className="skeleton" style={{ height: 320 }} />}
        {p && (
          <>
            <div className="card pcard">
              <Ava name={p.name} size="lg" />
              <h1 className="h1" style={{ fontSize: 30, marginTop: 10 }}>{p.name}</h1>
              <div className="muted">{ROLE[p.role]}</div>
              {verified && <span className="badge"><Icon name="shield" size={14} /> Проверенный исполнитель</span>}
              {p.about && <p style={{ marginTop: 10, maxWidth: 380, lineHeight: 1.5 }}>{p.about}</p>}
              <Ring value={p.rating} />
              {p.rating === null && <div className="small muted">Рейтинг появится после первого закрытого этапа</div>}
            </div>

            <div className="tiles">
              <div className="tile"><b>{p.acceptedStages}</b><span>этапов принято</span></div>
              <div className="tile"><b>{p.dealsCompleted}</b><span>сделок закрыто</span></div>
              <div className="tile"><b>{p.disputes}</b><span>споров</span></div>
            </div>

            <div className="card" style={{ padding: "6px 20px" }}>
              <div className="kv"><span className="muted">Получено через StepPay</span><b className="mono">{rub(p.received)}</b></div>
              <div className="kv"><span className="muted">Принято автоматически</span><b>{p.autoAccepted}</b></div>
              <div className="kv"><span className="muted">Не принято этапов</span><b>{p.failedStages}</b></div>
            </div>

            <p className="small muted" style={{ lineHeight: 1.5 }}>Рейтинг считается только по этапам, закрытым в сервисе. Чем больше принятых и меньше проваленных, тем он выше. Отзывы написать нельзя, поэтому рейтинг не накрутить.</p>
            <button className="btn" onClick={share}>{copied ? "Ссылка скопирована" : "Поделиться карточкой"}</button>
          </>
        )}
      </div>
    </div>
  );
}
