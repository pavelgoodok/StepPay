import { useId } from "react";

/**
 * Рисунок для карточки кошелька: несколько тонких дорожек с объемными узлами. Статичный, без анимации.
 * Два варианта под форму карточки (широкая на планшете и компьютере, высокая на телефоне): стили выбирают нужный.
 * Дорожки идут вдоль всей карточки по краям, середина остается свободной под цифры.
 */
type Trace = { d: string; dy?: number };
type Art = { box: string; traces: Trace[]; nodes: [number, number][] };

const WIDE: Art = {
  box: "0 0 1200 340",
  traces: [
    { d: "M0 26H340L366 50H640L668 24H1200" },
    { d: "M0 318H260L288 298H470H700L730 268H1010" },
    { d: "M400 206H560L600 166H820L850 196H1010" },
    { d: "M400 206H560L600 166H820L850 196H1010", dy: 16 },
  ],
  nodes: [[400, 206], [400, 222], [600, 166], [730, 268], [668, 24], [288, 298]],
};

const COMPACT: Art = {
  box: "0 0 1200 560",
  traces: [
    { d: "M0 50H300L340 90H620L660 50H1200" },
    { d: "M0 526H380L410 496H760L790 526H1200" },
    { d: "M820 130H980L1010 160H1200" },
    { d: "M820 130H980L1010 160H1200", dy: 16 },
  ],
  nodes: [[820, 130], [820, 146], [340, 90], [790, 526], [660, 50], [410, 496]],
};

function Drawing({ art, kind }: { art: Art; kind: "wide" | "compact" }) {
  const id = useId().replace(/:/g, "");
  const g = `g${id}`;
  const glow = `b${id}`;
  const shade = `s${id}`;
  const ball = `o${id}`;
  const w = Number(art.box.split(" ")[2]);
  return (
    <svg className={`net net-${kind}`} viewBox={art.box} preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={g} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={w} y2="0">
          <stop offset="0" stopColor="#c6dcff" stopOpacity="0.3" />
          <stop offset="0.5" stopColor="#c6dcff" stopOpacity="0.38" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.85" />
        </linearGradient>
        <filter id={glow} x="-10%" y="-40%" width="120%" height="180%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
        <filter id={shade} x="-60%" y="-60%" width="220%" height="220%">
          <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#00123f" floodOpacity="0.5" />
        </filter>
        <radialGradient id={ball} cx="0.34" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.5" stopColor="#b3d0ff" />
          <stop offset="1" stopColor="#4a7fe8" />
        </radialGradient>
      </defs>
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {art.traces.map((t, i) => (
          <g key={i} transform={`translate(0 ${t.dy ?? 0})`}>
            <path d={t.d} stroke={`url(#${g})`} strokeWidth="6" opacity="0.28" filter={`url(#${glow})`} vectorEffect="non-scaling-stroke" />
            <path d={t.d} stroke="#001a5c" strokeOpacity="0.45" strokeWidth="2" transform="translate(0 1.5)" vectorEffect="non-scaling-stroke" />
            <path d={t.d} stroke={`url(#${g})`} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          </g>
        ))}
      </g>
      <g filter={`url(#${shade})`}>
        {art.nodes.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="7.5" fill={`url(#${ball})`} />
        ))}
      </g>
    </svg>
  );
}

export function CircuitNet() {
  return (
    <>
      <Drawing art={WIDE} kind="wide" />
      <Drawing art={COMPACT} kind="compact" />
    </>
  );
}
