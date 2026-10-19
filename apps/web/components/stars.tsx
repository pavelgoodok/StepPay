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
  if (!reviews || rating == null) return <span className="small muted">Отзывов нет</span>;
  const word = reviews % 10 === 1 && reviews % 100 !== 11 ? "отзыв" : [2, 3, 4].includes(reviews % 10) && ![12, 13, 14].includes(reviews % 100) ? "отзыва" : "отзывов";
  return (
    <span className="small rating-line">
      <span className="rs"><Icon name="star" size={14} /></span>
      <b>{rating.toFixed(1).replace(".", ",")}</b>
      <span className="muted">· {reviews} {word}</span>
    </span>
  );
}

/** Отметка «Проверено» рядом с именем: данные подтверждены администратором. В списках показывается значком. */
export function VerifiedMark({ show, compact }: { show?: boolean; compact?: boolean }) {
  if (!show) return null;
  if (compact) {
    return (
      <span className="vmark" title="Данные подтверждены администратором" aria-label="Проверено">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      </span>
    );
  }
  return <span className="chip green" style={{ marginLeft: 8, verticalAlign: "middle" }}>Проверено</span>;
}
