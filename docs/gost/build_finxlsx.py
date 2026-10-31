# Книга Excel «Финансовая модель StepPay как продукта Банка ВТБ»: все расчеты формулами,
# допущения на отдельном листе, исходные данные из публикуемой отчетности Банка ВТБ по РСБУ.
import sys
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter as L

import fin_model as fm

FONT = "Times New Roman"
THIN = Side(style="thin", color="000000")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
INPUT = PatternFill("solid", fgColor="EAF0FB")  # ячейки допущений, которые можно менять
TH, MLN, PCT, INT = "#,##0", "#,##0.0", "0.0%", "0"


def cell(ws, ref, value, fmt=None, bold=False, fill=None, wrap=False, align=None, border=True):
    c = ws[ref]
    c.value = value
    c.font = Font(name=FONT, size=12, bold=bold)
    if fmt:
        c.number_format = fmt
    if fill:
        c.fill = fill
    c.alignment = Alignment(wrap_text=wrap, vertical="center", horizontal=align)
    if border:
        c.border = BOX
    return c


def title(ws, text, row=1):
    c = ws.cell(row=row, column=1, value=text)
    c.font = Font(name=FONT, size=14, bold=True)


def widths(ws, first, other, n):
    ws.column_dimensions["A"].width = first
    for i in range(2, n + 2):
        ws.column_dimensions[L(i)].width = other


def sheet_vtb(wb):
    ws = wb.active
    ws.title = "Отчетность ВТБ"
    title(ws, "Показатели публикуемой отчетности Банка ВТБ (ПАО) по РСБУ, тыс. руб.")
    cell(ws, "A3", "Показатель", bold=True, align="center")
    for j, p in enumerate(fm.PERIODS):
        cell(ws, f"{L(j + 2)}3", p, bold=True, align="center")
    for i, (name, vals) in enumerate(fm.VTB):
        r = 4 + i
        cell(ws, f"A{r}", name, wrap=True)
        for j, v in enumerate(vals):
            cell(ws, f"{L(j + 2)}{r}", v if v is not None else "н/д", TH, align="right")
    # строки: 4 активы, 5 вклады, 6 капитал, 7 проц. доходы, 8 ЧПД, 9 ком. доходы, 10 ком. расходы, 11 чистые доходы, 12 опер. расходы, 13 до налога, 14 прибыль
    cell(ws, "A16", "Расчетные показатели", bold=True, border=False)
    cell(ws, "A17", "Чистый комиссионный доход, тыс. руб.", wrap=True)
    for j in range(6):
        c = L(j + 2)
        cell(ws, f"{c}17", f"={c}9-{c}10", TH)
    cell(ws, "A18", "Прирост комиссионных доходов к предыдущему периоду", wrap=True)
    cell(ws, "A19", "Доля чистого комиссионного дохода в чистых доходах", wrap=True)
    cell(ws, "A20", "Отношение операционных расходов к чистым доходам", wrap=True)
    cell(ws, "A21", "Рентабельность капитала (прибыль к среднему капиталу)", wrap=True)
    cell(ws, "A22", "Средняя рентабельность капитала за 2023-2025 годы", wrap=True, bold=True)
    for j in range(6):
        c, prev = L(j + 2), L(j + 1)
        cell(ws, f"{c}18", f"={c}9/{prev}9-1" if j in (1, 2, 3) else (f"={c}9/F9-1" if j == 5 else "-"), PCT, align="right")
        cell(ws, f"{c}19", f"={c}17/{c}11" if j >= 1 else "-", PCT, align="right")
        cell(ws, f"{c}20", f"={c}12/{c}11" if j >= 1 else "-", PCT, align="right")
        cell(ws, f"{c}21", f"={c}14/AVERAGE({prev}6,{c}6)" if j in (1, 2, 3) else "-", PCT, align="right")
        cell(ws, f"{c}22", "=AVERAGE(C21:E21)" if j == 1 else "", PCT, align="right")
    notes = [
        "Источники: публикуемая отчетность Банка ВТБ (ПАО) за 2023, 2024 и 2025 годы с аудиторскими заключениями и за первое полугодие 2026 года (формы 0409806 и 0409807).",
        "Данные за 2022 год взяты из отчетности за 2023 год, за 2024 год из отчетности за 2025 год (графа предыдущего отчетного года).",
        "Баланс приведен на конец периода. Для первого полугодия 2025 года баланс в отчетности за первое полугодие 2026 года не раскрывается (н/д).",
        "Прирост за первое полугодие 2026 года рассчитан к первому полугодию 2025 года.",
    ]
    for i, t in enumerate(notes):
        ws.cell(row=24 + i, column=1, value=t).font = Font(name=FONT, size=11)
    widths(ws, 46, 17, 6)
    ws.freeze_panes = "B4"


def sheet_inputs(wb):
    ws = wb.create_sheet("Допущения")
    title(ws, "Допущения модели (выделенные ячейки можно изменять)")
    a = fm.A
    cell(ws, "A3", "Показатель", bold=True, align="center")
    cell(ws, "B3", "Значение", bold=True, align="center")
    cell(ws, "A4", "Сценарий (1 пониженный, 2 базовый, 3 повышенный)", wrap=True)
    cell(ws, "B4", a["scenario"], INT, fill=INPUT)
    cell(ws, "A6", "Оборот сделок по сценариям, млн руб.", bold=True, align="center")
    for j, h in enumerate(["1-й год", "2-й год", "3-й год"]):
        cell(ws, f"{L(j + 2)}6", h, bold=True, align="center")
    for i, (name, vals) in enumerate(fm.SCENARIOS.items()):
        cell(ws, f"A{7 + i}", name)
        for j, v in enumerate(vals):
            cell(ws, f"{L(j + 2)}{7 + i}", v, TH, fill=INPUT)

    def row(r, label, vals, fmt):
        cell(ws, f"A{r}", label, wrap=True)
        for j, v in enumerate(vals if isinstance(vals, list) else [vals]):
            cell(ws, f"{L(j + 2)}{r}", v, fmt, fill=INPUT)

    row(11, "Средний чек сделки, руб.", a["check_rub"], TH)
    row(12, "Комиссия исполнителя от выплаченной суммы", a["fee"], PCT)
    row(13, "Рост оборота после 3-го года в год", a["growth"], PCT)
    row(14, "Подписчиков Pro (1-й, 2-й, 3-й год)", a["subs"], TH)
    row(15, "Цена подписки Pro, руб. в месяц", a["sub_price"], TH)
    row(16, "Рост числа подписчиков после 3-го года в год", a["subs_growth"], PCT)
    row(17, "Выручка от сборов и грантов (1-й, 2-й, 3-й год), млн руб.", a["funds"], MLN)
    row(18, "Рост выручки от сборов и грантов после 3-го года в год", a["funds_growth"], PCT)
    row(19, "Доля сделок со спором", a["dispute_share"], PCT)
    row(20, "Доход платформы от сопровождения спора, руб.", a["dispute_rub"], TH)
    row(21, "Переменные расходы на сделку, руб.", a["var_rub"], TH)
    row(22, "Постоянные расходы (0-й, 1-й, 2-й, 3-й год), млн руб.", a["fixed"], MLN)
    row(23, "Рост постоянных расходов после 3-го года в год", a["fixed_growth"], PCT)
    row(24, "Капитальные вложения (0-й ... 5-й год), млн руб.", a["capex"], MLN)
    row(25, "Срок амортизации капитальных вложений, лет", a["life"], INT)
    row(26, "Ставка налога на прибыль", a["tax"], PCT)
    cell(ws, "A27", "Ставка дисконтирования (средняя рентабельность капитала Банка ВТБ за 2023-2025 годы)", wrap=True)
    cell(ws, "B27", "='Отчетность ВТБ'!C22", PCT)
    row(28, "Темп роста денежного потока после 2031 года (постпрогнозный период)", a["terminal_growth"], PCT)
    notes = [
        "Оборот базового сценария соответствует достижимому объему рынка: около 1,0 %, 5,2 % и 8,1 % доступного объема рынка 616 млрд руб.",
        "Постоянные расходы включают команду продукта, инфраструктуру, информационную безопасность, юридическое сопровождение и привлечение пользователей.",
        "Капитальные вложения 0-го года: доработка платформы, интеграция с платформой цифрового рубля, аудит смарт-контрактов.",
        "Средства сторон в цифровых рублях учитываются на платформе Банка России, процентный доход банка от резерва сделок в модели не учитывается.",
        "Рост после 3-го года 20 % в год отражает обязательное подключение к цифровому рублю остальных банков и торговых компаний до 2028 года.",
        "Темп роста после 2031 года принят на уровне цели Банка России по инфляции 4 %.",
    ]
    for i, t in enumerate(notes):
        ws.cell(row=30 + i, column=1, value=t).font = Font(name=FONT, size=11)
    widths(ws, 58, 13, 6)


def sheet_calc(wb):
    ws = wb.create_sheet("Расчет")
    title(ws, "Прогноз доходов, расходов и денежного потока продукта, млн руб.")
    D = "Допущения!"
    cols = [L(j + 2) for j in range(6)]
    cell(ws, "A3", "Показатель", bold=True, align="center")
    for j, y in enumerate(fm.YEARS):
        cell(ws, f"{cols[j]}3", f"{y}", bold=True, align="center")
    labels = {4: "Номер года", 5: "Оборот сделок", 6: "Число сделок, шт.", 7: "Комиссия исполнителя", 8: "Подписка Pro", 9: "Сборы и гранты",
              10: "Сопровождение споров", 11: "Выручка, всего", 12: "Переменные расходы", 13: "Постоянные расходы", 14: "Прибыль до вычета амортизации (EBITDA)",
              15: "Амортизация", 16: "Прибыль до налогообложения", 17: "Налог на прибыль", 18: "Чистая прибыль", 19: "Капитальные вложения",
              20: "Денежный поток", 21: "Накопленный денежный поток", 22: "Коэффициент дисконтирования", 23: "Дисконтированный денежный поток",
              24: "Накопленный дисконтированный денежный поток", 25: "Окупаемость (служебная строка), лет", 26: "Дисконтированная окупаемость (служебная строка), лет",
              27: "Рентабельность по EBITDA", 28: "Стоимость постпрогнозного периода на конец 2031 года",
              29: "Дисконтированная стоимость постпрогнозного периода"}
    bold_rows = {11, 14, 18, 20}
    for r, t in labels.items():
        cell(ws, f"A{r}", t, wrap=True, bold=r in bold_rows)
    for j, c in enumerate(cols):
        p = cols[j - 1] if j else None
        f = {}
        f[4] = j
        f[5] = 0 if j == 0 else (f"=INDEX({D}{L(j + 1)}$7:{L(j + 1)}$9,{D}$B$4)" if j <= 3 else f"={p}5*(1+{D}$B$13)")
        f[6] = f"={c}5*1000000/{D}$B$11"
        f[7] = f"={c}5*{D}$B$12"
        f[8] = 0 if j == 0 else (f"={D}{L(j + 1)}14*{D}$B$15*12/1000000" if j <= 3 else f"={p}8*(1+{D}$B$16)")
        f[9] = 0 if j == 0 else (f"={D}{L(j + 1)}17" if j <= 3 else f"={p}9*(1+{D}$B$18)")
        f[10] = f"={c}6*{D}$B$19*{D}$B$20/1000000"
        f[11] = f"=SUM({c}7:{c}10)"
        f[12] = f"={c}6*{D}$B$21/1000000"
        f[13] = f"={D}{c}22" if j <= 3 else f"={p}13*(1+{D}$B$23)"
        f[14] = f"={c}11-{c}12-{c}13"
        f[15] = 0 if j == 0 else f"=SUM({D}$B$24:{p}24)/{D}$B$25"
        f[16] = f"={c}14-{c}15"
        f[17] = f"={c}16*{D}$B$26"
        f[18] = f"={c}16-{c}17"
        f[19] = f"={D}{c}24"
        f[20] = f"={c}18+{c}15-{c}19"
        f[21] = f"={c}20" if j == 0 else f"={p}21+{c}20"
        f[22] = f"=1/(1+{D}$B$27)^{c}4"
        f[23] = f"={c}20*{c}22"
        f[24] = f"={c}23" if j == 0 else f"={p}24+{c}23"
        f[25] = "" if j == 0 else f'=IF(AND({c}21>=0,{p}21<0),{p}4+(-{p}21)/{c}20,"")'
        f[26] = "" if j == 0 else f'=IF(AND({c}24>=0,{p}24<0),{p}4+(-{p}24)/{c}23,"")'
        f[27] = f'=IF({c}11>0,{c}14/{c}11,"")'
        f[28] = f"={c}20*(1+{D}$B$28)/({D}$B$27-{D}$B$28)" if j == 5 else ""
        f[29] = f"={c}28*{c}22" if j == 5 else ""
        for r, v in f.items():
            fmt = INT if r == 4 else TH if r == 6 else "0.000" if r == 22 else "0.00" if r in (25, 26) else PCT if r == 27 else MLN
            cell(ws, f"{c}{r}", v, fmt, bold=r in bold_rows, align="right")
    widths(ws, 50, 13, 6)
    ws.freeze_panes = "B4"


def sheet_kpi(wb):
    ws = wb.create_sheet("Показатели")
    title(ws, "Показатели эффективности продукта для банка")
    cell(ws, "A3", "Показатель", bold=True, align="center")
    cell(ws, "B3", "Значение", bold=True, align="center")
    R, V = "Расчет!", "'Отчетность ВТБ'!"
    rows = [
        ("Чистая приведенная стоимость (NPV) с учетом постпрогнозного периода, млн руб.", f"=B5+{R}G29", MLN),
        ("Чистая приведенная стоимость (NPV) за 2026-2031 годы, млн руб.", f"={R}B20+NPV(Допущения!B27,{R}C20:G20)", MLN),
        ("Внутренняя норма доходности (IRR) за 2026-2031 годы", f"=IRR({R}B20:G20)", PCT),
        ("Срок окупаемости от начала проекта, лет", f'=IF(COUNT({R}C25:G25)=0,"за пределами горизонта",MIN({R}C25:G25))', "0.0"),
        ("Дисконтированный срок окупаемости, лет", f'=IF(COUNT({R}C26:G26)=0,"за пределами горизонта",MIN({R}C26:G26))', "0.0"),
        ("Ставка дисконтирования", "=Допущения!B27", PCT),
        ("Капитальные вложения за 2026-2031 годы, млн руб.", "=SUM(Допущения!B24:G24)", MLN),
        ("Выручка продукта в 3-м году (2029), млн руб.", f"={R}E11", MLN),
        ("Рентабельность по EBITDA в 3-м году", f"={R}E27", PCT),
        ("Доля выручки продукта 3-го года в комиссионных доходах Банка ВТБ за 2025 год", f"={R}E11*1000/{V}E9", "0.00%"),
        ("Доля чистой прибыли продукта 3-го года в прибыли Банка ВТБ за 2025 год", f"={R}E18*1000/{V}E14", "0.00%"),
    ]
    for i, (t, f, fmt) in enumerate(rows):
        cell(ws, f"A{4 + i}", t, wrap=True)
        cell(ws, f"B{4 + i}", f, fmt, align="right")
    widths(ws, 70, 18, 1)


def build(path):
    wb = Workbook()
    sheet_vtb(wb)
    sheet_inputs(wb)
    sheet_calc(wb)
    sheet_kpi(wb)
    for ws in wb.worksheets:
        ws.sheet_view.zoomScale = 100
        ws.page_setup.orientation = "landscape"
        ws.page_setup.fitToWidth = 1
    wb.save(path)


if __name__ == "__main__":
    build(sys.argv[1] if len(sys.argv) > 1 else "StepPay_VTB_Finmodel.xlsx")
    print("ok")
