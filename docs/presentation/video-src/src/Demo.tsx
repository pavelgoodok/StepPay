import React from "react";
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { Bg, FONT, NAVY } from "./ui";
import FRAMES from "./frames.json";

/**
 * Демо-ролик StepPay: 3D-телефон и ноутбук, интерфейс меняется прямо на экране устройства.
 * Рамки устройств лежат в public/frames с прозрачным экраном, углы экрана в frames.json;
 * экраны приложения натягиваются в окно перспективным преобразованием (matrix3d).
 */

type FrameKey = keyof typeof FRAMES;
type Cam = [number, number, number];
/** Шаг сценария: экран, надпись, пояснение и движение камеры (масштаб и сдвиг от центра устройства) от начала к концу шага. */
type Step = { src: string; caption: string; desc?: string; dur: number; amount?: number; from?: Cam; to?: Cam };

/** Перспективное преобразование прямоугольника w×h в четырехугольник (как в сборке макетов). */
function matrix3d(w: number, h: number, q: number[][]): string {
  const src = [[0, 0], [w, 0], [w, h], [0, h]];
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i]!;
    const [u, v] = q[i]!;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  // метод Гаусса
  const n = 8;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[p]![c]!)) p = r;
    [A[c], A[p]] = [A[p]!, A[c]!]; [b[c], b[p]] = [b[p]!, b[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = A[r]![c]! / A[c]![c]!;
      for (let j = c; j < n; j++) A[r]![j]! -= k * A[c]![j]!;
      b[r]! -= k * b[c]!;
    }
  }
  const h8 = b.map((v, i) => v / A[i]![i]!);
  const [a0, a1, a2, a3, a4, a5, a6, a7] = h8 as [number, number, number, number, number, number, number, number];
  return `matrix3d(${a0},${a3},0,${a6},${a1},${a4},0,${a7},0,0,1,0,${a2},${a5},0,1)`;
}

const PHONE_SHOT = { w: 1170, h: 2532 };
const LAPTOP_SHOT = { w: 2880, h: 1800 };

/** Размер экрана в пикселях снимка: ширина снимка, высота по пропорции окна устройства. */
function screenBox(key: FrameKey) {
  const q = FRAMES[key].quad;
  const d = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);
  const qw = (d(q[0]!, q[1]!) + d(q[3]!, q[2]!)) / 2;
  const qh = (d(q[0]!, q[3]!) + d(q[1]!, q[2]!)) / 2;
  const shot = key === "laptop" ? LAPTOP_SHOT : PHONE_SHOT;
  return { w: shot.w, h: Math.max(shot.h, (shot.w * qh) / qw) };
}

/** Устройство с меняющимся интерфейсом: новый экран проявляется на месте прежнего. */
/** Пролет через экран: 1 в начале сцены (камера внутри экрана) и в конце (камера влетает в экран), 0 в середине. */
function flyAt(f: number, total: number, zin: boolean, zout: boolean) {
  const io = Easing.inOut(Easing.cubic);
  const a = zin ? 1 - io(Math.min(1, Math.max(0, f / FLY))) : 0;
  const b = zout ? io(Math.min(1, Math.max(0, (f - (total - FLY)) / FLY))) : 0;
  return Math.max(a, b);
}
const FLY = 36;

const Device: React.FC<{ frame: FrameKey; steps: Step[]; x: number; y: number; h: number; enterDelay?: number; zin?: boolean; zout?: boolean }> = ({ frame, steps, x, y, h, enterDelay = 0, zin = false, zout = false }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const meta = FRAMES[frame];
  const k = h / meta.h;
  const box = screenBox(frame);
  const q = meta.quad.map(([a, b]) => [a! * k, b! * k]);
  const e = zin ? 1 : spring({ frame: f - enterDelay, fps, config: { damping: 18, stiffness: 55 } });
  const dy = 0;
  let t = 0;
  const starts = steps.map((s) => { const v = t; t += s.dur; return v; });
  const PUSH = 24;
  // камера: внутри шага плавно от from к to, на смене шага мягкий переход от прежнего положения
  const ci = Math.max(0, starts.findIndex((st, i) => f >= st && (starts[i + 1] === undefined || f < starts[i + 1]!)));
  const cs = steps[ci]!;
  const lerp = (a: Cam, b: Cam, p: number): Cam => [a[0] + (b[0] - a[0]) * p, a[1] + (b[1] - a[1]) * p, a[2] + (b[2] - a[2]) * p];
  const io = Easing.inOut(Easing.cubic);
  const local = f - starts[ci]!;
  let cam = lerp(cs.from ?? [1, 0, 0], cs.to ?? cs.from ?? [1, 0, 0], io(Math.min(1, Math.max(0, local / cs.dur))));
  if (ci > 0 && local < 40) { const pv = steps[ci - 1]!; cam = lerp(pv.to ?? pv.from ?? [1, 0, 0], cam, io(local / 40)); }
  // у телефона приближение мягче: экран крупнее, но устройство остается в кадре
  if (frame !== "laptop") cam = [1 + (cam[0] - 1) * 0.35, cam[1] * 0.4, cam[2] * 0.4];
  // пролет: экран устройства заполняет кадр
  const fly = flyAt(f, t, zin, zout);
  const qc = [(q[0]![0]! + q[1]![0]! + q[2]![0]! + q[3]![0]!) / 4, (q[0]![1]! + q[1]![1]! + q[2]![1]! + q[3]![1]!) / 4];
  const qwPx = (Math.hypot(q[1]![0]! - q[0]![0]!, q[1]![1]! - q[0]![1]!) + Math.hypot(q[2]![0]! - q[3]![0]!, q[2]![1]! - q[3]![1]!)) / 2;
  const qhPx = (Math.hypot(q[3]![0]! - q[0]![0]!, q[3]![1]! - q[0]![1]!) + Math.hypot(q[2]![0]! - q[1]![0]!, q[2]![1]! - q[1]![1]!)) / 2;
  const zFill = 1.15 * Math.max(1920 / qwPx, 1080 / qhPx);
  const sc = Math.pow(cam[0], 1 - fly) * Math.pow(zFill, fly);
  const tx = cam[1] * (1 - fly) + (960 - (x + qc[0]!)) * fly;
  const ty = cam[2] * (1 - fly) + (540 - (y + qc[1]!)) * fly;
  return (
    <div style={{ position: "absolute", left: x, top: y, width: meta.w * k, height: h, opacity: Math.min(1, e * 1.5), transformOrigin: `${qc[0]}px ${qc[1]}px`, transform: `translate(${tx}px, ${(1 - e) * 600 + dy + ty}px) scale(${(0.92 + 0.08 * e) * sc})`, filter: "drop-shadow(0 50px 60px rgba(2,24,90,.5))" }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: box.w, height: box.h, transformOrigin: "0 0", transform: matrix3d(box.w, box.h, q), overflow: "hidden", background: "#0b1020" }}>
        {steps.map((s, i) => {
          const st = starts[i]!;
          if (f < st - 1 && i > 0) return null;
          const p = i === 0 ? 1 : interpolate(f, [st, st + PUSH], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.2, 0.8, 0.2, 1) });
          const next = starts[i + 1];
          const out = next === undefined ? 0 : interpolate(f, [next, next + PUSH], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.2, 0.8, 0.2, 1) });
          return (
            <Img key={s.src} src={staticFile(`demo/${s.src}.png`)} style={{ position: "absolute", left: 0, top: 0, width: box.w, height: box.h, objectFit: "fill", opacity: p, visibility: out >= 1 ? "hidden" : "visible" }} />
          );
        })}
      </div>
      <Img src={staticFile(`frames/${frame}.png`)} style={{ position: "absolute", left: 0, top: 0, width: meta.w * k, height: h }} />
      {meta.glare && <Img src={staticFile(`frames/${frame}_glare.png`)} style={{ position: "absolute", left: 0, top: 0, width: meta.w * k, height: h }} />}
    </div>
  );
};

/** Надписи по шагам: белые заглавные, слова появляются по очереди, прежняя надпись уходит вверх. */
const Captions: React.FC<{ steps: Step[]; x?: number; y?: number; w?: number; size?: number; center?: boolean; lead?: number }> = ({ steps, x = 100, y = 150, w = 760, size = 80, center = false, lead = 0 }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  let t = 0;
  return (
    <>
      {steps.map((s, idx) => {
        const st = t; t += s.dur;
        const end = t;
        if (f < st - 2 || f > end + 12) return null;
        const outE = idx === steps.length - 1 ? 0 : interpolate(f, [end - 10, end + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        const st0 = st + (idx === 0 ? lead : 0);
        const words = s.caption.split(" ");
        return (
          <div key={idx} style={{ position: "absolute", left: x, top: y, width: w, opacity: 1 - outE, transform: `translateY(${-outE * 40}px)` }}>
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: center ? "center" : "flex-start", columnGap: size * 0.26, fontFamily: FONT, fontWeight: 900, fontSize: size, lineHeight: 1.04, color: "#fff", letterSpacing: -1, textTransform: "uppercase", textShadow: "0 4px 24px rgba(2,24,90,.5)" }}>
              {words.map((wd, i) => {
                if (wd === "\n") return <div key={i} style={{ flexBasis: "100%", height: 0 }} />;
                const e = spring({ frame: f - st0 - 10 - i * 7, fps, config: { damping: 18, stiffness: 90 } });
                return (
                  <span key={i} style={{ display: "inline-block", overflow: "hidden" }}>
                    <span style={{ display: "inline-block", transform: `translateY(${(1 - e) * 100}%)`, opacity: e }}>{wd}</span>
                  </span>
                );
              })}
            </div>
            {s.desc && <Desc text={s.desc} delay={st0 + 24 + words.length * 7} size={Math.round(size * 0.42)} center={center} />}
            {s.amount !== undefined && <Amount to={s.amount} delay={st0 + 34} />}
          </div>
        );
      })}
    </>
  );
};

/** Пояснение под надписью: заглавные буквы помельче, появляется после надписи. */
const Desc: React.FC<{ text: string; delay: number; size: number; center?: boolean }> = ({ text, delay, size, center = false }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const e = spring({ frame: f - delay, fps, config: { damping: 20, stiffness: 80 } });
  return <div style={{ marginTop: 28, maxWidth: center ? 1100 : 640, marginLeft: center ? "auto" : 0, marginRight: center ? "auto" : 0, textAlign: center ? "center" : "left", fontFamily: FONT, fontWeight: 700, fontSize: size, lineHeight: 1.3, letterSpacing: 0.5, color: "rgba(255,255,255,.88)", textTransform: "uppercase", opacity: e, transform: `translateY(${(1 - e) * 24}px)`, textShadow: "0 2px 18px rgba(2,24,90,.45)" }}>{text}</div>;
};

const Amount: React.FC<{ to: number; delay: number }> = ({ to, delay }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const e = spring({ frame: f - delay, fps, config: { damping: 18, stiffness: 100 } });
  const v = Math.round(interpolate(f, [delay, delay + 60], [0, to], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) }));
  return <div style={{ marginTop: 40, fontFamily: FONT, fontWeight: 900, fontSize: 120, color: "#fff", letterSpacing: -3, opacity: e, transform: `translateY(${(1 - e) * 40}px)` }}>{v.toLocaleString("ru-RU").replace(/ /g, " ")} ₽</div>;
};

const sum = (s: Step[]) => s.reduce((a, b) => a + b.dur, 0);

/** Стеклянные кубы на фоне: по краям кадра, за надписями и устройствами, медленно дрейфуют. */
type Cube = [n: number, x: number, y: number, w: number, rot: number, blur?: number];
const CUBES: Record<"phone" | "phoneL" | "laptop" | "logo", Cube[]> = {
  phoneL: [[4, 1640, 760, 360, 8], [1, 1180, 880, 200, -14, 3], [2, -70, -90, 300, -10, 2], [3, -60, 800, 260, 12]],
  phone: [[3, -90, 720, 380, -8], [1, 640, 850, 210, 14, 3], [2, 1690, -90, 300, 10, 2], [4, 1700, 780, 270, -12]],
  laptop: [[4, -100, 640, 380, 8], [1, 120, 120, 200, -10, 3], [2, 1600, 80, 320, 12, 2], [3, 1640, 720, 300, -18]],
  logo: [[2, 140, 120, 300, -12], [4, 1420, 90, 340, 10], [1, 260, 760, 260, 16, 2], [3, 1480, 700, 380, -8]],
};
const Cubes: React.FC<{ set: keyof typeof CUBES }> = ({ set }) => {
  const f = useCurrentFrame();
  return (
    <>
      {CUBES[set].map(([n, x, y, w, rot, blur = 0], i) => (
        <Img key={i} src={staticFile(`cubes/cube${n}.png`)} style={{ position: "absolute", left: x, top: y + Math.sin((f + i * 40) / 70) * 14, width: w, transform: `rotate(${rot + Math.sin((f + i * 25) / 110) * 4}deg)`, opacity: blur ? 0.7 : 0.9, filter: `${blur ? `blur(${blur}px) ` : ""}drop-shadow(0 30px 40px rgba(2,24,90,.35))` }} />
      ))}
    </>
  );
};

/** Сцена: синий фон, устройство справа, слева или по центру, надписи на свободной стороне. Пролет через экран на входе и выходе. */
const Stage: React.FC<{ device: FrameKey; steps: Step[]; variant?: "blue" | "mix"; side?: "right" | "left" | "center"; zin?: boolean; zout?: boolean }> = ({ device, steps, variant = "blue", side = "right", zin = false, zout = false }) => {
  const f = useCurrentFrame();
  const total = sum(steps);
  const fly = flyAt(f, total, zin, zout);
  const capOpacity = Math.max(0, 1 - fly * 2);
  const laptop = device === "laptop";
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Bg variant={variant} />
      <Cubes set={laptop ? "laptop" : side === "left" ? "phoneL" : "phone"} />
      {laptop ? <Device frame="laptop" steps={steps} x={406} y={300} h={840} zin={zin} zout={zout} /> : <Device frame={device} steps={steps} x={side === "left" ? 380 : 1120} y={30} h={1020} zin={zin} zout={zout} />}
      <div style={{ position: "absolute", inset: 0, opacity: capOpacity }}>
        {laptop ? <Captions steps={steps} x={0} y={60} w={1920} size={60} center lead={zin ? FLY - 10 : 0} /> : <Captions steps={steps} x={side === "left" ? 1060 : 100} w={760} size={80} y={160} lead={zin ? FLY - 10 : 0} />}
      </div>
    </AbsoluteFill>
  );
};

/* ───── сценарий ───── */
const CUSTOMER_1: Step[] = [
  { src: "m01_catalog", caption: "Заказчик находит исполнителя", desc: "Каталог проверенных исполнителей", dur: 135, from: [1, 0, 30], to: [1.3, -40, 220] },
  { src: "m02_chat", caption: "Договорились в чате", desc: "Исполнитель оформляет задачу", dur: 130, from: [1.55, -30, 330], to: [1.7, -40, 120] },
];
const EXECUTOR_1: Step[] = [{ src: "m03_terms", caption: "Этапы, суммы и неустойка", desc: "Каждый этап со своими условиями приемки", dur: 165, from: [1.15, 0, 330], to: [1.75, 40, -160] }];
const CUSTOMER_2: Step[] = [
  { src: "m04_review", caption: "Контракт подписан", desc: "Условия зафиксированы и не меняются", dur: 130, from: [1.1, 0, 80], to: [1.55, -20, 300] },
  { src: "m06_reserved", caption: "Вся сумма в резерве", desc: "Деньги хранятся в эскроу-кошельке", dur: 140, from: [1.7, 0, 470], to: [1.85, -10, 420] },
];
const CUSTOMER_3: Step[] = [
  { src: "m07_submitted", caption: "Этап сдан", desc: "Заказчик проверяет результат", dur: 125, from: [1.3, 0, -60], to: [1.65, 0, -330] },
  { src: "m08_progress", caption: "Этап принят и оплачен", desc: "Выплата уходит исполнителю сразу", dur: 125, from: [1.7, 0, -260], to: [1.35, 0, 20] },
  { src: "m09_journal", caption: "История сделки под защитой", desc: "Каждое действие записано", dur: 125, from: [1.2, 0, 160], to: [1.55, 0, 260] },
];
const EXECUTOR_2: Step[] = [
  { src: "m10_wallet", caption: "Оплата получена", desc: "Деньги в кошельке исполнителя", dur: 135, from: [1, 0, 0], to: [1.7, 0, 430] },
  { src: "m11_deals", caption: "Остаток в резерве", desc: "До приемки следующих этапов", dur: 125, from: [1.6, 0, 300], to: [1.2, 0, 0] },
];
const ADMIN: Step[] = [
  { src: "a01_dashboard", caption: "Панель администратора", desc: "Все сделки на одном экране", dur: 135, from: [1, 0, 20], to: [1.25, 0, 110] },
  { src: "a02_transactions", caption: "Операции участников", desc: "Резервы, выплаты и неустойки", dur: 125, from: [1.25, 0, 110], to: [1.4, -60, 150] },
  { src: "a05_projects", caption: "Проверка проектов", desc: "Публикация после модерации", dur: 125, from: [1.4, -60, 150], to: [1.05, 0, 40] },
];

/* ───── заставка и финал: логотип ───── */
const Intro: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const burst = interpolate(f, [0, 28], [0, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const card = spring({ frame: f - 8, fps, config: { damping: 11, stiffness: 140 } });
  const logo = spring({ frame: f - 18, fps, config: { damping: 14, stiffness: 120 } });
  const shine = interpolate(f, [30, 62], [-40, 140], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Bg variant="blue" />
      <Cubes set="logo" />
      <div style={{ position: "absolute", left: 960 - 700 * burst, top: 470 - 700 * burst, width: 1400 * burst, height: 1400 * burst, borderRadius: "50%", border: `${6 * (1 - burst) + 1}px solid rgba(255,255,255,${0.6 * (1 - burst)})` }} />
      <div style={{ position: "absolute", left: 960 - 330, top: 330, width: 660, height: 280, borderRadius: 40, background: "#fff", display: "grid", placeItems: "center", overflow: "hidden", boxShadow: "0 40px 80px rgba(2,28,100,.45)", transform: `scale(${card}) rotate(${(1 - card) * -8}deg)`, opacity: Math.min(1, card * 2) }}>
        <Img src={staticFile("img/logo.png")} style={{ width: 520, opacity: logo, transform: `translateY(${(1 - logo) * 40}px)` }} />
        <div style={{ position: "absolute", top: 0, bottom: 0, left: `${shine}%`, width: 120, background: "linear-gradient(90deg, transparent, rgba(255,255,255,.75), transparent)", transform: "skewX(-20deg)" }} />
      </div>
      <Captions steps={[{ src: "", caption: "Оплата работ по этапам", dur: 999 }]} x={0} y={680} w={1920} size={64} center />
    </AbsoluteFill>
  );
};

const Outro: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const card = spring({ frame: f - 4, fps, config: { damping: 13, stiffness: 120 } });
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Bg variant="blue" />
      <Cubes set="logo" />
      <div style={{ position: "absolute", left: 960 - 300, top: 250, width: 600, height: 250, borderRadius: 36, background: "#fff", display: "grid", placeItems: "center", boxShadow: "0 40px 80px rgba(2,28,100,.45)", transform: `scale(${card})` }}>
        <Img src={staticFile("img/logo.png")} style={{ width: 470 }} />
      </div>
      <Captions steps={[{ src: "", caption: "Гарантия выплат \n Гарантия результата", dur: 999 }]} x={0} y={570} w={1920} size={84} center />
    </AbsoluteFill>
  );
};

const SCENES: { C: React.FC; dur: number; fadeOut: number }[] = [
  { C: Intro, dur: 140, fadeOut: 20 },
  { C: () => <Stage device="phone" steps={CUSTOMER_1} side="right" zout />, dur: sum(CUSTOMER_1), fadeOut: 10 },
  { C: () => <Stage device="phone_r" steps={EXECUTOR_1} side="left" variant="mix" zin zout />, dur: sum(EXECUTOR_1), fadeOut: 10 },
  { C: () => <Stage device="phone" steps={CUSTOMER_2} side="right" zin zout />, dur: sum(CUSTOMER_2), fadeOut: 10 },
  { C: () => <Stage device="phone_r" steps={CUSTOMER_3} side="left" variant="mix" zin zout />, dur: sum(CUSTOMER_3), fadeOut: 10 },
  { C: () => <Stage device="phone" steps={EXECUTOR_2} side="right" zin zout />, dur: sum(EXECUTOR_2), fadeOut: 10 },
  { C: () => <Stage device="laptop" steps={ADMIN} side="center" variant="mix" zin />, dur: sum(ADMIN), fadeOut: 24 },
  { C: Outro, dur: 150, fadeOut: 0 },
];
export const DEMO_FRAMES = SCENES.reduce((a, s) => a + s.dur - s.fadeOut, 0);

export const StepPayDemo: React.FC = () => (
  <AbsoluteFill style={{ background: NAVY }}>
    <TransitionSeries>
      {SCENES.map(({ C, dur }, i) => (
        <React.Fragment key={i}>
          <TransitionSeries.Sequence durationInFrames={dur}>
            <C />
          </TransitionSeries.Sequence>
          {i < SCENES.length - 1 && <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: SCENES[i]!.fadeOut })} />}
        </React.Fragment>
      ))}
    </TransitionSeries>
  </AbsoluteFill>
);
