"use client";
import { Icon } from "./ui";

/** Пять звезд: только показ или выбор оценки. */
export function Stars({ value, onChange, size = 18 }: { value: number; onChange?: (v: number) => void; size?: number }) {
  return (
    <span className="stars" role={onChange ? "radiogroup" : "img"} aria-label={`Оценка ${value} из 5`}>
      {[1, 2, 3, 4, 5].map((n) =>
        onChange ? (
          <button key={n} type="button" className={n <= value ? "on" : ""} aria-label={`${n}`} onClick={() => onChange(n)}><Icon name="star" size={size} /></button>
        ) : (
          <i key={n} className={n <= Math.round(value) ? "on" : ""}><Icon name="star" size={size} /></i>
        ),
      )}
    </span>
  );
}

/** Рейтинг числом со звездой: 4,3 · 12 отзывов. */
export function RatingLine({ rating, reviews }: { rating?: number | null; reviews?: number }) {
  if (!reviews || rating == null) return <span className="small muted">Пока без отзывов</span>;
  const word = reviews % 10 === 1 && reviews % 100 !== 11 ? "отзыв" : [2, 3, 4].includes(reviews % 10) && ![12, 13, 14].includes(reviews % 100) ? "отзыва" : "отзывов";
  return (
    <span className="small rating-line">
      <span className="rs"><Icon name="star" size={14} /></span>
      <b>{rating.toFixed(1).replace(".", ",")}</b>
      <span className="muted">· {reviews} {word}</span>
    </span>
  );
}
