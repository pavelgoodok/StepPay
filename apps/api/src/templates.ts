import { splitProRata } from "@steppay/engine";

export interface Template {
  id: string;
  title: string;
  icon: string;
  stages: { title: string; share: number; criteria: string[] }[];
}

export const TEMPLATES: Template[] = [
  {
    id: "bathroom",
    title: "Ремонт ванной",
    icon: "bath",
    stages: [
      { title: "Демонтаж", share: 10, criteria: ["Старая отделка снята", "Мусор вывезен"] },
      { title: "Электрика и сантехника", share: 20, criteria: ["Проводка и трубы проложены", "Опрессовка без протечек"] },
      { title: "Плитка", share: 40, criteria: ["Швы ровные", "Плитка без сколов", "Уровень соблюден"] },
      { title: "Сантехника и чистовая", share: 30, criteria: ["Приборы установлены", "Уборка после работ"] },
    ],
  },
  {
    id: "kitchen",
    title: "Кухня",
    icon: "kitchen",
    stages: [
      { title: "Замеры и проект", share: 10, criteria: ["Утвержден проект"] },
      { title: "Материалы и фурнитура", share: 40, criteria: ["Чеки на материалы"] },
      { title: "Сборка и монтаж", share: 40, criteria: ["Модули собраны", "Фасады выровнены"] },
      { title: "Подключение и сдача", share: 10, criteria: ["Техника подключена"] },
    ],
  },
  {
    id: "electric",
    title: "Электрика",
    icon: "bolt",
    stages: [
      { title: "Схема и материалы", share: 30, criteria: ["Схема согласована", "Чеки на кабель и автоматы"] },
      { title: "Прокладка и монтаж", share: 50, criteria: ["Проводка проложена", "Розетки и выключатели установлены"] },
      { title: "Щиток и проверка", share: 20, criteria: ["Протокол замеров"] },
    ],
  },
  {
    id: "site",
    title: "Сайт",
    icon: "laptop",
    stages: [
      { title: "Дизайн", share: 30, criteria: ["Макеты всех страниц утверждены"] },
      { title: "Верстка и разработка", share: 50, criteria: ["Сайт работает на тестовом адресе", "Адаптив"] },
      { title: "Запуск", share: 20, criteria: ["Сайт на боевом домене", "Передан доступ"] },
    ],
  },
  {
    id: "wedding",
    title: "Свадьба под ключ",
    icon: "ring",
    stages: [
      { title: "Площадка и подрядчики", share: 40, criteria: ["Договоры подписаны"] },
      { title: "Декор и программа", share: 30, criteria: ["Эскизы утверждены"] },
      { title: "День свадьбы", share: 30, criteria: ["Мероприятие проведено по программе"] },
    ],
  },
];

export function stagesFromTemplate(templateId: string, totalKopecks: number) {
  const t = TEMPLATES.find((x) => x.id === templateId);
  if (!t) return null;
  const amounts = splitProRata(totalKopecks, Object.fromEntries(t.stages.map((s, i) => [String(i), s.share])));
  return t.stages.map((s, i) => ({ title: s.title, criteria: s.criteria, amount: amounts[String(i)] ?? 0 }));
}
