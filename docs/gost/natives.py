# Данные и оформление диаграмм Word для аналитических документов (источники данных указаны в документах).
from pptx.enum.chart import XL_CHART_TYPE as T
import docxchart as dc

NAVY, BLUE, LIGHT, GRAY, AMBER, GREEN = "#0A2A7A", "#2F5BEA", "#C9D3EA", "#8A94A8", "#D98B1C", "#1E8A55"


def num(v, d=1):
    return f"{v:.{d}f}".replace(".", ",")


# ───── проблема ─────
def izhs():
    return dc.bars(["Льготные заемщики, не получившие дом (Банк России)", "Пострадавшие от подрядчиков в ИЖС (оценка Госдумы)"], [5, 20],
                   [BLUE, NAVY], value_title="тыс. человек", vmax=25, height_cm=7, gap=120,
                   labels=["около 5 тыс.", "более 20 тыс."])


def subsidies():
    return dc.bars(["Нарушения при субсидиях юридическим лицам", "Прочие нарушения"], [354.7, 580.2 - 354.7], [NAVY, LIGHT],
                   value_title="млрд руб. (всего 580,2)", fmt='0.0', vmax=420, height_cm=7, gap=120,
                   labels=["354,7 (61 %)", "225,5 (39 %)"])


def nonpay():
    return dc.bars(["I кв.", "II кв.", "III кв.", "IV кв."], [27, 26, 39, 42], [LIGHT, LIGHT, BLUE, NAVY],
                   value_title="Доля компаний, %", vmax=50, height_cm=7, labels=["27 %", "26 %", "39 %", "42 %"])


def selfemployed():
    v = [15.427 / 1.268, 15.427, 17.3]
    return dc.bars(["Конец 2024", "Конец 2025", "Август 2026"], [round(x, 1) for x in v], [LIGHT, BLUE, NAVY],
                   value_title="млн человек", fmt='0.0', vmax=20, height_cm=7,
                   labels=[num(x) for x in v])


def grants():
    return dc.bars(["Подано заявок", "Поддержано проектов"], [11000, 1640], [LIGHT, NAVY],
                   value_title="Количество проектов", fmt='# ##0', vmax=14000, height_cm=7, gap=120,
                   labels=["около 11 000", "1 640 (около 15 %)"])


def venture():
    return dc.multi(["2024", "2025"], [("Объем инвестиций, млн долл.", [177, 159]), ("Число сделок", [176, 102])],
                    [LIGHT, NAVY], T.COLUMN_CLUSTERED, vmax=200, height_cm=7.5, gap=80)


# ───── рынок ─────
def m_selfemployed():
    return dc.bars(["2024", "2025"], [2.2, 3.0], [LIGHT, NAVY], value_title="трлн руб.", fmt='0.0', vmax=3.5, height_cm=6.5,
                   labels=["2,2", "3,0 (+38,6 %)"])


def m_funding():
    return dc.bars(["Инвестиционные платформы, 2025 (не входят в рынок)", "Фонд президентских грантов, 2025", "Planeta.ru, 2024"], [23.66, 9.5, 0.2],
                   [LIGHT, NAVY, BLUE], value_title="млрд руб.", fmt='0.0', vmax=28, height_cm=7, gap=100,
                   labels=["23,66", "9,5", "0,2"])


def m_positioning():
    pts = [("Профи.ру", 2.0, 1.6), ("Авито Услуги", 4.4, 3.5), ("YouDo", 3.4, 2.4), ("Kwork", 5.2, 1.4), ("FL.ru", 5.6, 2.3),
           ("Эскроу в ИЖС", 6.6, 4.4), ("Planeta.ru", 2.4, 6.2), ("Отчетность по грантам", 3.6, 7.2), ("StepPay", 8.7, 8.4)]
    cols = [GRAY] * 5 + [BLUE, AMBER, AMBER, NAVY]
    return dc.scatter(pts, cols, "Защита денег до приемки результата (низкая - высокая)",
                      "Охват: сделки, сборы, гранты (узкий - широкий)", xmax=10.5, ymax=10)


# ───── монетизация ─────
def fees():
    return dc.multi(["FL.ru", "Kwork", "YouDo", "StepPay, исполнитель", "StepPay, заказчик"],
                    [("Минимальная ставка", [7, 7.5, 11, 1.5, 0]), ("Диапазон до максимальной", [13, 12.5, 0, 0, 0])],
                    [NAVY, LIGHT], T.BAR_STACKED, value_title="% от суммы заказа", fmt='0.0', vmax=22, height_cm=7.5, gap=60, overlap=100,
                    texts={0: ["7", "7,5", "11 + 35 руб.", "1,5", "0"], 1: ["до 20", "до 20", "", "", ""]})


def unit():
    gf = dc.multi(["Комиссия исполнителя 1,5 %", "Переменные расходы", "Вклад со сделки"], [("Основа", [0, 3500, 0]), ("Сумма", [4500, 1000, 3500])],
                  [NAVY, NAVY], T.COLUMN_STACKED, value_title="руб.", vmax=5000, height_cm=7, legend=False, gap=60, overlap=100, hidden=(0,))
    s = gf.chart.plots[0].series[1]
    for i, c in enumerate([NAVY, AMBER, GREEN]):
        s.points[i].format.fill.solid(); s.points[i].format.fill.fore_color.rgb = dc.rgb(c)
    return gf


def breakeven():
    return dc.lines_xy([("Вклад от сделок", [(0, 0), (7000, 24500)]), ("Постоянные расходы на старте", [(0, 5000), (7000, 5000)]),
                        ("Постоянные расходы на третьем году", [(0, 20000), (7000, 20000)])],
                       [NAVY, AMBER, GRAY], "Сделок в месяц (точка безубыточности 1 430 на старте и около 5 700 на третьем году)", "тыс. руб. в месяц", xmax=7000, ymax=25000)


def stepwise():
    """Выгода заказчика на ремонте за 300 тыс. руб.: комиссия площадки, которую он не платит, скидка и неустойка."""
    return dc.bars(["Нет комиссии площадки", "Скидка за гарантию 3 %", "Неустойка за 6 дней"],
                   [21, 9, 2.7], [LIGHT, GREEN, BLUE], value_title="тыс. руб.", fmt='0.0', vmax=25, height_cm=7.5, gap=100,
                   labels=["от 21,0", "9,0", "2,7"])


def revenue():
    return dc.multi(["1-й год", "2-й год", "3-й год"], [("Комиссия исполнителя", [96, 480, 750]), ("Подписка Pro", [11.8, 58.8, 117.6]),
                    ("Сборы и гранты", [5, 20, 50]), ("Споры", [0.2, 1.0, 1.5])],
                    [NAVY, BLUE, LIGHT, AMBER], T.COLUMN_STACKED, value_title="млн руб.", fmt='0', vmax=1000, height_cm=8.5, gap=70, overlap=100,
                    texts={0: ["96", "480", "750"], 1: ["", "58,8", "117,6"], 2: ["", "", "50"], 3: ["", "", ""]})
