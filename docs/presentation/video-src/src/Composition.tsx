import React from "react";
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { BLUE, Bg, Card, Count, FONT, Glass, LAV, Label, Menu, NAVY, Phone, Title } from "./ui";

const T = 18;
const SCENES = [150, 210, 270, 190, 270, 190, 170, 170, 200, 170];
export const TOTAL_FRAMES = SCENES.reduce((a, b) => a + b, 0) - T * (SCENES.length - 1);

/* 1. Заставка */
const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const e = spring({ frame, fps, config: { damping: 18, stiffness: 90 } });
  return (
    <AbsoluteFill>
      <Bg variant="blue" />
      <Glass src="img/ring.png" x={1040} y={-40} w={1000} rot={-14} amp={22} />
      <div style={{ position: "absolute", left: 60, top: 50, width: 330, height: 130, borderRadius: 26, background: "#fff", display: "grid", placeItems: "center", boxShadow: "0 12px 30px rgba(2,40,114,.4)", opacity: e, transform: `scale(${0.8 + 0.2 * e})` }}>
        <Img src={staticFile("img/logo.png")} style={{ width: 280 }} />
      </div>
      <Title text="ПОЭТАПНОЕ ФИНАНСИРОВАНИЕ УСЛУГ И ПРОЕКТОВ" size={100} x={60} y={290} w={1300} delay={12} />
      <Label text="С использованием цифрового рубля" x={64} y={780} w={1100} delay={60} size={44} weight={600} />
    </AbsoluteFill>
  );
};

/* 2. Проблематика */
const Problem: React.FC = () => (
  <AbsoluteFill>
    <Bg variant="blue" />
    <Menu active={0} />
    <Glass src="img/wave.png" x={1130} y={620} w={820} rot={-6} amp={10} delay={20} />
    <Title text="АВАНС НЕ ГАРАНТИРУЕТ РЕЗУЛЬТАТ, ВЫПОЛНЕННАЯ РАБОТА – ОПЛАТУ" size={84} y={140} w={1700} />
    <Label text="ЧЕГО БОЯТСЯ ПОЛЬЗОВАТЕЛИ" x={64} y={460} w={900} delay={50} size={36} weight={800} />
    <Card x={60} y={540} w={800} h={380} delay={60} from="left">
      <div style={{ fontWeight: 900, fontSize: 52, color: BLUE }}>ЗАКАЗЧИК</div>
      <div style={{ fontSize: 50, marginTop: 20, lineHeight: 1.2, fontWeight: 500 }}>Заплатить заранее и остаться без результата</div>
    </Card>
    <Card x={920} y={540} w={800} h={380} delay={85} from="right">
      <div style={{ fontWeight: 900, fontSize: 52, color: BLUE }}>ИСПОЛНИТЕЛЬ</div>
      <div style={{ fontSize: 50, marginTop: 20, lineHeight: 1.2, fontWeight: 500 }}>Сделать работу и не получить оплату</div>
    </Card>
  </AbsoluteFill>
);

/* 3. Решение: пять шагов */
const Steps: React.FC = () => {
  const frame = useCurrentFrame();
  const names = ["ДОГОВОР", "РЕЗЕРВ", "ЭТАП СДАН", "ПРИНЯТ", "ОПЛАТА"];
  const progress = interpolate(frame, [70, 230], [0, 4], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const x0 = 260, gap = 350;
  return (
    <AbsoluteFill>
      <Bg variant="light" />
      <Menu active={1} />
      <Img src={staticFile("img/logo.png")} style={{ position: "absolute", left: 60, top: 140, width: 420 }} />
      <Title text="ОПЛАТА ПО ШАГАМ" color={BLUE} size={96} x={500} y={160} w={1300} delay={6} />
      <Label text="Этапы и правила приемки фиксируются до начала работ" x={64} y={420} w={1700} delay={40} size={42} color={NAVY} weight={700} />
      <div style={{ position: "absolute", left: x0, top: 640, width: gap * 4, height: 10, borderRadius: 5, background: "rgba(2,40,114,.25)" }} />
      <div style={{ position: "absolute", left: x0, top: 640, width: (gap * 4) * Math.min(progress / 4, 1), height: 10, borderRadius: 5, background: NAVY }} />
      {names.map((n, i) => {
        const on = progress >= i - 0.01;
        return (
          <div key={n} style={{ position: "absolute", left: x0 + gap * i - 150, top: 590, width: 300, textAlign: "center", fontFamily: FONT }}>
            <div style={{ margin: "0 auto", width: 110, height: 110, borderRadius: 55, background: on ? NAVY : "#fff", color: on ? "#fff" : BLUE, fontWeight: 900, fontSize: 54, display: "grid", placeItems: "center", boxShadow: "0 10px 24px rgba(2,40,114,.35)", transform: `scale(${on ? 1 : 0.9})` }}>{i + 1}</div>
            <div style={{ marginTop: 24, fontWeight: 800, fontSize: 30, color: NAVY }}>{n}</div>
          </div>
        );
      })}
      <Label text="Деньги резервируются заранее и уходят исполнителю только за принятый этап" x={64} y={880} w={1700} delay={200} size={40} color={NAVY} weight={700} />
    </AbsoluteFill>
  );
};

/* 4. Правила выплаты */
const Rules: React.FC = () => {
  const rows = [["Принят этап", "Выплата исполнителю"], ["Открыт спор", "Удержание суммы этапа"], ["Сделка отменена", "Возврат остатка"]];
  return (
    <AbsoluteFill>
      <Bg variant="blue" />
      <Menu active={1} />
      <Glass src="img/s.png" x={1220} y={80} w={760} rot={0} amp={16} />
      <Title text="ЦИФРОВОЙ РУБЛЬ & ПЛАТЕЖ С УСЛОВИЕМ" size={88} y={140} w={1250} />
      <Label text="Принятый этап запускает выплату" x={64} y={430} w={1100} delay={30} size={44} weight={800} />
      {rows.map(([a, b], i) => (
        <Card key={a} x={60} y={520 + i * 150} w={1150} h={126} delay={50 + i * 22} from="left" radius={30}>
          <div style={{ display: "flex", alignItems: "center", height: "100%", justifyContent: "space-between", margin: "-10px 0" }}>
            <span style={{ fontWeight: 900, fontSize: 46 }}>{a}</span>
            <span style={{ fontWeight: 600, fontSize: 42, color: BLUE }}>{b}</span>
          </div>
        </Card>
      ))}
    </AbsoluteFill>
  );
};

/* 5. Продукт */
const Product: React.FC = () => (
  <AbsoluteFill>
    <Bg variant="mix" />
    <Menu active={3} />
    <Title text="ПРОДУКТ НА ЭКРАНЕ ТЕЛЕФОНА" size={80} y={125} w={1500} />
    <Glass src="img/ring.png" x={1450} y={90} w={420} rot={20} amp={14} delay={30} />
    <Phone src="img/phone-deal.png" x={170} y={290} h={700} delay={20} />
    <Phone src="img/phone-wallet.png" x={760} y={260} h={740} delay={40} />
    <Phone src="img/phone-chat.png" x={1360} y={290} h={700} delay={60} />
    <Label text="Сделка по этапам" x={110} y={1010} w={560} delay={90} size={32} align="center" color={NAVY} weight={800} />
    <Label text="Кошелек в цифровых рублях" x={690} y={1010} w={560} delay={105} size={32} align="center" color={NAVY} weight={800} />
    <Label text="Чат и согласование условий" x={1290} y={1010} w={560} delay={120} size={32} align="center" color={NAVY} weight={800} />
  </AbsoluteFill>
);

/* 6. Технологии */
const Tech: React.FC = () => {
  const layers = [["ПРИЛОЖЕНИЕ", "Веб и мобильный интерфейс, вход по passkey"], ["СЕРВЕР СДЕЛОК", "API, чаты, уведомления, отзывы и рейтинг"], ["ЯДРО ПРАВИЛ", "Этапы, резерв, выплата, споры, сроки"], ["ЖУРНАЛ СДЕЛКИ", "Цепочка хешей, якоря во внешнем источнике"], ["ИСПОЛНЕНИЕ", "Смарт-контракт Ethereum, затем платформа цифрового рубля"]];
  return (
    <AbsoluteFill>
      <Bg variant="blue" />
      <Menu active={3} />
      <Title text="ТЕХНОЛОГИЧЕСКИЕ РЕШЕНИЯ" size={80} y={125} w={1300} />
      {layers.map(([h, d], i) => (
        <Card key={h} x={60} y={330 + i * 126} w={1180} h={108} delay={25 + i * 14} from="left" fill={i === 4 ? "#fff" : LAV} radius={24}>
          <div style={{ display: "flex", alignItems: "center", height: "100%", margin: "-16px 0", gap: 30 }}>
            <span style={{ fontWeight: 900, fontSize: 32, color: BLUE, width: 330 }}>{h}</span>
            <span style={{ fontWeight: 600, fontSize: 30, width: 760 }}>{d}</span>
          </div>
        </Card>
      ))}
      <Phone src="img/phone-exec.png" x={1380} y={150} h={880} delay={30} />
    </AbsoluteFill>
  );
};

/* 7. Рынок и конкуренты */
const Market: React.FC = () => {
  const cols = [["Площадки", ["Частично", "Нет", "Нет"]], ["Эскроу банка", ["Сложно", "Да", "Нет"]], ["StepPay", ["Да", "Да", "Да"]]] as const;
  const crit = ["Оплата по этапам", "Независимость от площадки", "Проверяемый журнал"];
  return (
    <AbsoluteFill>
      <Bg variant="light" />
      <Menu active={2} />
      <Title text="КОНКУРЕНТНЫЙ АНАЛИЗ" color={NAVY} size={84} y={125} w={1400} />
      <Glass src="img/wave.png" x={1180} y={90} w={700} rot={-4} amp={8} delay={10} />
      {crit.map((c, r) => (
        <Label key={c} text={c} x={60} y={430 + r * 150 + 30} w={640} delay={30 + r * 8} size={40} color={NAVY} weight={800} />
      ))}
      {cols.map(([name, vals], ci) => (
        <React.Fragment key={name}>
          <Card x={740 + ci * 370} y={300} w={340} h={620} delay={25 + ci * 12} fill={ci === 2 ? BLUE : "#fff"} radius={30}>
            <div style={{ textAlign: "center", fontWeight: 900, fontSize: 36, color: ci === 2 ? "#fff" : NAVY, height: 80 }}>{name}</div>
            {vals.map((v, ri) => (
              <div key={ri} style={{ textAlign: "center", fontWeight: 800, fontSize: 42, color: ci === 2 ? "#fff" : v === "Да" ? BLUE : "#6F7FB3", height: 150, display: "grid", placeItems: "center" }}>{v}</div>
            ))}
          </Card>
        </React.Fragment>
      ))}
    </AbsoluteFill>
  );
};

/* 8. Экономика */
const Money: React.FC = () => {
  const stats: [string, number, string, string][] = [["₽", 750, "выручка со сделки", "чек 50 000 ₽, комиссия 1,5%"], ["₽", 600, "вклад со сделки", "после расходов 150 ₽"], ["", 500, "сделок в месяц", "безубыточность"]];
  return (
    <AbsoluteFill>
      <Bg variant="blue" />
      <Menu active={4} />
      <Glass src="img/s.png" x={1600} y={40} w={300} rot={8} amp={10} />
      <Title text="ЭКОНОМИКА СДЕЛКИ" size={84} y={125} w={1300} />
      {stats.map(([u, n, cap, sub], i) => (
        <Card key={cap} x={60 + i * 610} y={380} w={570} h={470} delay={25 + i * 16}>
          <div style={{ fontWeight: 900, fontSize: 120, color: BLUE, marginTop: 10 }}>
            <Count to={n} delay={35 + i * 16} /> {u}
          </div>
          <div style={{ fontWeight: 900, fontSize: 36, marginTop: 24 }}>{cap.toUpperCase()}</div>
          <div style={{ fontWeight: 500, fontSize: 32, marginTop: 14 }}>{sub}</div>
        </Card>
      ))}
      <Label text="Расчет иллюстративный, параметры проверяются в пилоте" x={64} y={930} w={1500} delay={120} size={34} weight={600} />
    </AbsoluteFill>
  );
};

/* 9. Roadmap */
const Roadmap: React.FC = () => {
  const frame = useCurrentFrame();
  const ph = [["ОКТ 2026", "Прототип и тестовая сеть"], ["НОЯ 2026", "Интервью и обращение в Банк России"], ["I КВ 2027", "Аудит, юрлицо, банк-партнер"], ["II КВ 2027", "Пилот: 100 сделок"], ["II ПОЛ 2027", "Платформа цифрового рубля"]];
  const line = interpolate(frame, [30, 150], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill>
      <Bg variant="mix" />
      <Menu active={5} />
      <Title text="ROADMAP" size={90} y={125} w={1300} />
      <Glass src="img/arch.png" x={1560} y={720} w={330} rot={0} amp={10} />
      <div style={{ position: "absolute", left: 130, top: 520, width: 1560, height: 8, borderRadius: 4, background: "rgba(255,255,255,.35)" }} />
      <div style={{ position: "absolute", left: 130, top: 520, width: 1560 * line, height: 8, borderRadius: 4, background: "#fff" }} />
      {ph.map(([d, t], i) => (
        <Card key={d} x={60 + i * 360} y={600} w={330} h={300} delay={30 + i * 22} fill={i === 0 ? BLUE : LAV} radius={26}>
          <div style={{ fontWeight: 900, fontSize: 34, color: i === 0 ? "#fff" : BLUE }}>{d}</div>
          <div style={{ fontWeight: 600, fontSize: 32, marginTop: 14, lineHeight: 1.2, color: i === 0 ? "#fff" : NAVY }}>{t}</div>
        </Card>
      ))}
      {ph.map(([d], i) => {
        const on = line * 4 >= i - 0.02;
        return <div key={d} style={{ position: "absolute", left: 130 + i * 390 - 28 + (i === 4 ? -20 : 0), top: 496, width: 56, height: 56, borderRadius: 28, background: on ? "#fff" : "rgba(255,255,255,.4)", boxShadow: "0 8px 18px rgba(2,40,114,.35)", display: "grid", placeItems: "center", fontFamily: FONT, fontWeight: 900, fontSize: 28, color: BLUE }}>{i + 1}</div>;
      })}
    </AbsoluteFill>
  );
};

/* 10. Финал */
const Outro: React.FC = () => {
  const asks = [["АУДИТ", "Независимая проверка кода и контрактов"], ["ПАРТНЕР", "Банк-участник платформы цифрового рубля"], ["ПИЛОТ", "100 сделок в сегменте ремонта"]];
  return (
    <AbsoluteFill>
      <Bg variant="light" />
      <Menu active={5} />
      <Img src={staticFile("img/logo.png")} style={{ position: "absolute", left: 60, top: 140, width: 420 }} />
      <Title text="ЧТО НУЖНО ДЛЯ ЗАПУСКА" color={NAVY} size={88} x={60} y={330} w={1100} />
      {asks.map(([h, d], i) => (
        <Card key={h} x={60} y={640 + i * 110} w={1100} h={92} delay={30 + i * 16} from="left" radius={24}>
          <div style={{ display: "flex", alignItems: "center", height: "100%", margin: "-20px 0", gap: 30 }}>
            <span style={{ fontWeight: 900, fontSize: 32, color: BLUE, width: 220 }}>{h}</span>
            <span style={{ fontWeight: 600, fontSize: 32 }}>{d}</span>
          </div>
        </Card>
      ))}
      <Label text="Гудков Павел Алексеевич  pavlusha220@yandex.ru  +7 995 540-71-20" x={60} y={990} w={1300} delay={110} size={30} color={NAVY} weight={700} />
      <Glass src="img/ring.png" x={1330} y={40} w={420} rot={20} amp={14} delay={20} />
      <Phone src="img/phone-deal-front.png" x={1370} y={250} h={800} delay={30} />
    </AbsoluteFill>
  );
};

const order: [React.FC, number][] = [[Intro, 0], [Problem, 1], [Steps, 2], [Rules, 3], [Product, 4], [Tech, 5], [Market, 6], [Money, 7], [Roadmap, 8], [Outro, 9]];
const presentations: any[] = [fade(), slide({ direction: "from-right" }), wipe({ direction: "from-left" }), slide({ direction: "from-bottom" }), fade(), slide({ direction: "from-right" }), wipe({ direction: "from-bottom" }), slide({ direction: "from-left" }), fade()];

export const StepPayVideo: React.FC = () => (
  <AbsoluteFill style={{ background: "#0A3FF6" }}>
    <TransitionSeries>
      {order.map(([C], i) => (
        <React.Fragment key={i}>
          <TransitionSeries.Sequence durationInFrames={SCENES[i]}>
            <C />
          </TransitionSeries.Sequence>
          {i < order.length - 1 ? <TransitionSeries.Transition presentation={presentations[i]} timing={linearTiming({ durationInFrames: T })} /> : null}
        </React.Fragment>
      ))}
    </TransitionSeries>
  </AbsoluteFill>
);
