"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ReviewCard } from "@/components/review-card";
import { Ava, Icon } from "@/components/ui";
import { RatingLine, Stars, VerifiedMark } from "@/components/stars";
import { api, type Person, type ReviewItem, type ServiceItem } from "@/lib/api";
import { dayLabel, rub } from "@/lib/format";
import { usePoll } from "@/lib/session";

export default function UserReviews() {
  const { id } = useParams<{ id: string }>();
  const { data, error } = usePoll(() => api<{ user: Person; rating: number | null; reviews: number; open: { ref: string; title: string }[]; services: ServiceItem[]; stats: { dealsCompleted: number; acceptedStages: number }; items: ReviewItem[] }>(`/users/${id}/reviews`), [id]);
  if (error && !data) return <div className="page"><div className="note bad">{error}</div></div>;
  if (!data) return <div className="page"><div className="skeleton" /></div>;
  return (
    <div className="page">
      <button className="btn ghost sm" style={{ paddingLeft: 0, alignSelf: "flex-start" }} onClick={() => history.back()}><Icon name="back" size={18} /> Назад</button>
      <div className="card pcard">
        <Ava name={data.user.name} src={data.user.avatar} size="lg" />
        <h1 className="h1" style={{ fontSize: 26, marginTop: 8 }}>{data.user.name}<VerifiedMark show={data.user.verified} /></h1>
        {data.rating != null && <div className="big-rating">{data.rating.toFixed(1).replace(".", ",")}</div>}
        {data.rating != null && <Stars value={data.rating} size={22} />}
        <RatingLine rating={data.rating} reviews={data.reviews} />
      </div>
      <div className="tiles">
        <div className="tile"><b>{data.stats.dealsCompleted}</b><span>завершено сделок</span></div>
        <div className="tile"><b>{data.stats.acceptedStages}</b><span>принято этапов</span></div>
        <div className="tile"><b>{data.reviews}</b><span>отзывов</span></div>
      </div>
      {data.services.length > 0 && (
        <>
          <h2 className="title">Услуги</h2>
          {data.services.map((s) => (
            <Link key={s.id} href={`/services/${s.id}`} className="card tap row">
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="small muted">{s.category}</div>
                <b className="ellipsis" style={{ display: "block" }}>{s.title}</b>
              </div>
              {s.priceFrom ? <b className="mono">от {rub(s.priceFrom)}</b> : null}
              <Icon name="arrow" size={18} />
            </Link>
          ))}
        </>
      )}
      {data.open[0] && <ReviewCard dealId={data.open[0].ref} />}
      <h2 className="title">Отзывы</h2>
      {data.items.length === 0 && <div className="card empty"><div className="sub">Отзывы появятся после завершенных сделок</div></div>}
      {data.items.map((r) => (
        <div key={r.id} className="card stack" style={{ gap: 6 }}>
          <div className="row between"><Stars value={r.stars} /><span className="small muted">{dayLabel(r.at)}</span></div>
          {r.text && <div style={{ whiteSpace: "pre-wrap" }}>{r.text}</div>}
          <div className="small muted">{r.from.name} · {r.dealTitle}</div>
        </div>
      ))}
      <Link href="/catalog" className="small muted" style={{ textAlign: "center" }}>В каталог</Link>
    </div>
  );
}
