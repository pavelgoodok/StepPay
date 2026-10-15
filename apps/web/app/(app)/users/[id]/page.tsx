"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Ava, Icon } from "@/components/ui";
import { RatingLine, Stars } from "@/components/stars";
import { api, type Person, type ReviewItem } from "@/lib/api";
import { dayLabel } from "@/lib/format";
import { usePoll } from "@/lib/session";

export default function UserReviews() {
  const { id } = useParams<{ id: string }>();
  const { data, error } = usePoll(() => api<{ user: Person; rating: number | null; reviews: number; items: ReviewItem[] }>(`/users/${id}/reviews`), [id]);
  if (error && !data) return <div className="page"><div className="note bad">{error}</div></div>;
  if (!data) return <div className="page"><div className="skeleton" /></div>;
  return (
    <div className="page">
      <button className="btn ghost sm" style={{ paddingLeft: 0, alignSelf: "flex-start" }} onClick={() => history.back()}><Icon name="back" size={18} /> Назад</button>
      <div className="card pcard">
        <Ava name={data.user.name} src={data.user.avatar} size="lg" />
        <h1 className="h1" style={{ fontSize: 26, marginTop: 8 }}>{data.user.name}</h1>
        {data.rating != null && <div className="big-rating">{data.rating.toFixed(1).replace(".", ",")}</div>}
        {data.rating != null && <Stars value={data.rating} size={22} />}
        <RatingLine rating={data.rating} reviews={data.reviews} />
      </div>
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
