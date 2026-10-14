import { useId } from "react";

/**
 * Стеклянные грани для карточки кошелька, как на референсе: несколько диагональных линий с фаской и подсветкой кромки,
 * между ними мягкие панели и блики. Статично, без анимации. Два рисунка под форму карточки (широкая и высокая):
 * какой показывать, решают стили по ширине самой карточки.
 */
type Art = { box: string; lines: string[]; panels: string[]; shines: { cx: number; cy: number; rx: number; ry: number; r: number; o: number }[] };

const WIDE: Art = {
  box: "0 0 1200 340",
  lines: ["M600 340L940 0", "M770 340L1110 0", "M790 176H850L880 212H1200"],
  panels: ["M600 340H770L1110 0H940Z"],
  shines: [
    { cx: 770, cy: 100, rx: 120, ry: 11, r: -45, o: 0.5 },
    { cx: 1010, cy: 268, rx: 90, ry: 9, r: -14, o: 0.38 },
  ],
};

const COMPACT: Art = {
  box: "0 0 1200 560",
  lines: ["M660 560L1200 20", "M850 560L1200 210", "M930 352H1000L1030 388H1200"],
  panels: ["M660 560H850L1200 210V20Z"],
  shines: [
    { cx: 940, cy: 200, rx: 140, ry: 13, r: -45, o: 0.5 },
    { cx: 1040, cy: 470, rx: 100, ry: 10, r: -14, o: 0.36 },
  ],
};

function Drawing({ art, kind }: { art: Art; kind: "wide" | "compact" }) {
  const id = useId().replace(/:/g, "");
  const body = `b${id}`;
  const panel = `p${id}`;
  const blur = `f${id}`;
  const soft = `s${id}`;
  const glint = `g${id}`;
  const w = Number(art.box.split(" ")[2]);
  return (
    <svg className={`net net-${kind}`} viewBox={art.box} preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={body} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={w} y2="0">
          <stop offset="0.4" stopColor="#2f66ff" />
          <stop offset="1" stopColor="#9fd0ff" />
        </linearGradient>
        <linearGradient id={panel} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#7fb0ff" stopOpacity="0.06" />
          <stop offset="0.55" stopColor="#8fbcff" stopOpacity="0.26" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.38" />
        </linearGradient>
        <filter id={blur} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
        <filter id={soft} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.4" />
        </filter>
        <filter id={glint} x="-30%" y="-100%" width="160%" height="300%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>

      {art.panels.map((d, i) => (
        <path key={`p${i}`} d={d} fill={`url(#${panel})`} />
      ))}
      {art.shines.map((s, i) => (
        <ellipse key={`s${i}`} cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} transform={`rotate(${s.r} ${s.cx} ${s.cy})`} fill="#fff" opacity={s.o} filter={`url(#${glint})`} />
      ))}

      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {art.lines.map((d, i) => (
          <g key={i}>
            <path d={d} stroke="#4f95ff" strokeWidth="14" opacity="0.4" filter={`url(#${blur})`} vectorEffect="non-scaling-stroke" />
            <path d={d} stroke="#00104a" strokeOpacity="0.62" strokeWidth="9" transform="translate(1.4 2.4)" filter={`url(#${soft})`} vectorEffect="non-scaling-stroke" />
            <path d={d} stroke={`url(#${body})`} strokeWidth="6" vectorEffect="non-scaling-stroke" />
            <path d={d} stroke="#eaf5ff" strokeOpacity="0.95" strokeWidth="1.6" transform="translate(-0.9 -1.1)" vectorEffect="non-scaling-stroke" />
            <path d={d} stroke="#ffffff" strokeOpacity="0.32" strokeWidth="0.9" transform="translate(2.6 2.8)" vectorEffect="non-scaling-stroke" />
          </g>
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
