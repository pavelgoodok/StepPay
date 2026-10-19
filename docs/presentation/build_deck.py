import copy, re, sys
from pptx import Presentation
from pptx.util import Emu, Pt, Inches
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
from pptx.oxml.ns import qn
from lxml import etree

BASE = "/tmp/claude-0/-home-user-StepPay/832a7ee6-9448-5006-9064-9786c8e613ff/scratchpad/"
A = BASE + "assets/"
M = BASE + "deck/x/ppt/media/"
NAVY, BLUE, LAV, WHITE = "022872", "0C40F6", "CAD6FD", "FFFFFF"
TITLE_FONT, BODY_FONT = "Segoe UI Black", "Segoe UI"
I = 914400

prs = Presentation(BASE + "deck/orig.pptx")
S = list(prs.slides)
blank = prs.slide_layouts[6]

def rgb(h): return RGBColor.from_string(h)

def set_font(run, size, color, bold=False, font=BODY_FONT):
    run.font.size = Pt(size); run.font.color.rgb = rgb(color); run.font.bold = bold
    run.font.name = font
    rPr = run._r.get_or_add_rPr()
    for tag in ("a:ea", "a:cs"):
        el = rPr.find(qn(tag))
        if el is None:
            el = etree.SubElement(rPr, qn(tag))
        el.set("typeface", font)

def text(slide, x, y, w, h, lines, size=18, color=NAVY, bold=False, font=BODY_FONT, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, name=None, spacing=1.0, after=0):
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    if name: tb.name = name
    tf = tb.text_frame; tf.word_wrap = True
    tf.margin_left = tf.margin_right = Inches(0.05); tf.margin_top = tf.margin_bottom = Inches(0.03)
    tf.vertical_anchor = anchor
    if isinstance(lines, str): lines = [lines]
    for i, ln in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align; p.line_spacing = spacing; p.space_after = Pt(after)
        if isinstance(ln, tuple): t, o = ln
        else: t, o = ln, {}
        r = p.add_run(); r.text = t
        set_font(r, o.get("size", size), o.get("color", color), o.get("bold", bold), o.get("font", font))
    return tb

def card(slide, x, y, w, h, fill=LAV, radius=0.1, shadow=True, name=None, alpha=None):
    sh = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    sh.adjustments[0] = radius
    if name: sh.name = name
    sh.fill.solid(); sh.fill.fore_color.rgb = rgb(fill)
    sh.line.fill.background()
    spPr = sh._element.spPr
    for e in spPr.findall(qn("a:effectLst")): spPr.remove(e)
    if shadow:
        eff = etree.SubElement(spPr, qn("a:effectLst"))
        sd = etree.SubElement(eff, qn("a:outerShdw"), blurRad="76200", dist="38100", dir="5400000", algn="t", rotWithShape="0")
        c = etree.SubElement(sd, qn("a:prstClr"), val="black"); etree.SubElement(c, qn("a:alpha"), val="35000")
    # убрать стиль, чтобы не было лишних линий и теней темы
    st = sh._element.find(qn("p:style"))
    if st is not None: sh._element.remove(st)
    return sh

def pic(slide, path, x, y, w=None, h=None, name=None):
    kw = {}
    if w: kw["width"] = Inches(w)
    if h: kw["height"] = Inches(h)
    p = slide.shapes.add_picture(path, Inches(x), Inches(y), **kw)
    if name: p.name = name
    return p

def copy_bg(dst, src):
    sb = src._element.find(qn("p:cSld")).find(qn("p:bg"))
    cs = dst._element.find(qn("p:cSld"))
    old = cs.find(qn("p:bg"))
    if old is not None: cs.remove(old)
    if sb is not None: cs.insert(0, copy.deepcopy(sb))

def circ(slide, cx, cy, d, fill, text_=None, color=WHITE, size=16, name=None):
    sh = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(cx - d/2), Inches(cy - d/2), Inches(d), Inches(d))
    if name: sh.name = name
    sh.fill.solid(); sh.fill.fore_color.rgb = rgb(fill); sh.line.fill.background()
    st = sh._element.find(qn("p:style"))
    if st is not None: sh._element.remove(st)
    if text_ is not None:
        tf = sh.text_frame; tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
        p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
        r = p.add_run(); r.text = text_; set_font(r, size, color, True, TITLE_FONT)
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    return sh

MENU = ["ПРОБЛЕМАТИКА", "РЕШЕНИЕ", "АНАЛИЗ РЫНКА", "ТЕХНОЛОГИЯ", "ФИНАНСЫ", "ROADMAP"]
menu_src = [sh for sh in S[1].shapes if sh.shape_type == 6][0]

def add_menu(slide, active, existing=None):
    """Верхнее меню как у автора; активная вкладка темная, остальные светлые."""
    grp = existing
    if grp is None:
        el = copy.deepcopy(menu_src._element)
        slide.shapes._spTree.append(el)
        grp = [sh for sh in slide.shapes if sh.shape_type == 6][-1]
    grp.name = "!!menu"
    rects = [s for s in grp.shapes if s.shape_type == 1]
    boxes = [s for s in grp.shapes if s.shape_type == 17]
    for i, (r, b) in enumerate(zip(rects, boxes)):
        r.fill.solid(); r.fill.fore_color.rgb = rgb(NAVY if i == active else LAV)
        for p in b.text_frame.paragraphs:
            for run in p.runs: run.font.color.rgb = rgb(WHITE if i == active else NAVY)
    return grp

def title(slide, t, x=0.2, y=0.95, w=12.4, h=1.2, color=WHITE, size=40):
    return text(slide, x, y, w, h, t, size=size, color=color, bold=False, font=TITLE_FONT, name="Slide title", spacing=0.9)

def new_slide(bg_from):
    s = prs.slides.add_slide(blank)
    for sh in list(s.shapes): sh._element.getparent().remove(sh._element)
    if bg_from is not None: copy_bg(s, bg_from)
    return s

def notes(slide, t):
    ns = slide.notes_slide
    if ns.notes_text_frame is None:
        src = S[1].notes_slide
        for sh in list(ns.shapes): sh._element.getparent().remove(sh._element)
        for sh in src.shapes: ns.shapes._spTree.append(copy.deepcopy(sh._element))
    ns.notes_text_frame.text = t

# ---------------- правки существующих слайдов ----------------
# 4: опечатка автора
for sh in S[3].shapes:
    if sh.has_text_frame and "ФИНАНСИРОВНИЯ" in sh.text_frame.text:
        for p in sh.text_frame.paragraphs:
            for r in p.runs: r.text = r.text.replace("ФИНАНСИРОВНИЯ", "ФИНАНСИРОВАНИЯ")
        # слово разнесено по run-ам: проверим целиком
        full = sh.text_frame.text
for sh in S[3].shapes:
    if sh.has_text_frame:
        for p in sh.text_frame.paragraphs:
            joined = "".join(r.text for r in p.runs)
            if "ФИНАНСИРОВН" in joined and p.runs:
                p.runs[0].text = joined.replace("ФИНАНСИРОВНИЯ", "ФИНАНСИРОВАНИЯ")
                for r in p.runs[1:]: r.text = ""

# 3: наполнение
s3 = S[2]
add_menu(s3, 0, [sh for sh in s3.shapes if sh.shape_type == 6][0])
for sh in s3.shapes:
    if sh.name == "Slide title":
        sh.top = Inches(0.95)
card(s3, 0.5, 2.35, 7.3, 2.15)
text(s3, 0.8, 2.5, 6.8, 0.45, "УЖЕ ЕСТЬ", size=22, color=BLUE, font=TITLE_FONT)
text(s3, 0.8, 3.0, 6.8, 1.4, ["• Работающий прототип: сделки, кошелек, чаты, отзывы", "• Смарт-контракт в тестовой сети Ethereum", "• Около 200 автоматических проверок", "• Документация по ЕСПД"], size=17, color=NAVY, after=3)
card(s3, 0.5, 4.75, 7.3, 2.25)
text(s3, 0.8, 4.9, 6.8, 0.45, "НЕ ХВАТАЕТ ДЛЯ ЗАПУСКА", size=22, color=BLUE, font=TITLE_FONT)
text(s3, 0.8, 5.4, 6.8, 1.5, ["• Независимого аудита кода и контрактов", "• Юридического лица и договора с банком", "• Пилота с реальными пользователями", "• Подключения к платформе цифрового рубля"], size=17, color=NAVY, after=3)
pic(s3, A + "phone-deals.png", 9.2, 2.0, h=5.3, name="!!phoneA")
notes(s3, "Проект существует как работающий прототип. Для запуска не хватает аудита, юридической структуры, партнера из числа банков и пилота. Эти этапы раскрыты на слайде Roadmap.")

# 5, 6, 7: добавляем верхнее меню и аккуратно сжимаем содержимое под него
K = (7.45 - 0.66) / (7.45 - 0.4)
def remap_y(y): return Inches(0.66 + (y / I - 0.4) * K)
for idx, act in ((4, 1), (5, 1), (6, 1)):
    s = S[idx]
    add_menu(s, act)
    for sh in list(s.shapes):
        if sh.name == "!!menu": continue
        if sh.shape_type == 13:
            if idx == 6 and sh.name == "Рисунок 38":
                sh.width = int(sh.width * 0.93); sh.height = int(sh.height * 0.93); sh.top = Inches(0.27)
            continue
        sh.top = remap_y(sh.top); sh.height = int(sh.height * K)
        if sh.name == "Slide title" and sh.has_text_frame:
            f = 0.93 if idx == 6 else 0.86
            if idx == 6:
                sh.top = Inches(0.78)
                p0 = sh.text_frame.paragraphs[0]
                if p0.runs: p0.runs[0].text = "      " + p0.runs[0].text.lstrip()
            for p in sh.text_frame.paragraphs:
                for r in p.runs:
                    if r.font.size: r.font.size = int(r.font.size * f)
        if idx == 4 and sh.has_text_frame and sh.text_frame.text.startswith("РЕЗЕРВ ПОДТВ"):
            sh.top = Inches(1.5)

# ---------------- новые слайды ----------------
bg_a, bg_b, bg_c, bg_d = S[2], S[4], S[6], S[3]

# 8. Рынок
s8 = new_slide(None); add_menu(s8, 2)
title(s8, "КОМУ НУЖЕН СЕРВИС", w=8.5)
segs = [("ЧАСТНЫЕ ЗАКАЗЧИКИ", "Ремонт, обучение, мероприятия: суммы от десятков тысяч рублей"),
        ("САМОЗАНЯТЫЕ И ИП", "Получают оплату по этапам и подтверждение платежа"),
        ("МАЛЫЙ БИЗНЕС", "Подряд, разработка, маркетинг: результат проверяется по этапам"),
        ("ПРОЕКТЫ И ГРАНТЫ", "Краудфандинг и целевое финансирование с отчетом по этапам")]
for i, (h, d) in enumerate(segs):
    x = 0.5 + (i % 2) * 4.3; y = 2.2 + (i // 2) * 2.15
    card(s8, x, y, 4.1, 1.95)
    text(s8, x + 0.2, y + 0.15, 3.7, 0.5, h, size=17, color=BLUE, font=TITLE_FONT)
    text(s8, x + 0.2, y + 0.75, 3.7, 1.1, d, size=15, color=NAVY)
card(s8, 9.3, 2.2, 3.6, 4.1, fill=WHITE)
text(s8, 9.5, 2.35, 3.2, 0.5, "КАК ОЦЕНИМ РЫНОК", size=17, color=BLUE, font=TITLE_FONT)
text(s8, 9.5, 2.95, 3.25, 3.3, [("TAM", {"bold": True, "font": TITLE_FONT, "size": 14}), "Все расчеты с этапами между людьми и организациями", ("SAM", {"bold": True, "font": TITLE_FONT, "size": 14}), "Ремонт и ИТ-услуги в городах пилота", ("SOM", {"bold": True, "font": TITLE_FONT, "size": 14}), "Первые 100 сделок пилота"], size=14, color=NAVY, after=2)
text(s8, 0.5, 6.75, 8.5, 0.45, "Объем рынка уточняется по данным Росстата, ФНС и интервью с исполнителями", size=14, color=WHITE)
pic(s8, M + "image3.png", 10.2, 5.7, h=1.7, name="!!deco")
notes(s8, "Сегменты выбраны по признаку: работа делится на проверяемые этапы. Количественная оценка рынка будет получена на спринте 1 по открытым данным и интервью. Здесь приведена методика.")

# 9. Конкуренты
s9 = new_slide(bg_d); add_menu(s9, 2)
title(s9, "КОНКУРЕНТНЫЙ АНАЛИЗ", color=NAVY, w=9)
rows = [("Критерий", "Безопасная сделка площадок", "Эскроу и аккредитив банка", "StepPay"),
        ("Оплата по этапам", "Частично", "Да, но сложно", "Да"),
        ("Малые суммы и короткие работы", "Да", "Нет", "Да"),
        ("Независимость от площадки", "Нет", "Да", "Да"),
        ("Проверяемый журнал сделки", "Нет", "Нет", "Да"),
        ("Цифровой рубль", "Нет", "Нет", "Целевая модель"),
        ("Спор по заранее известным правилам", "Правила площадки", "Суд", "Приемщик из реестра")]
tbl_shape = s9.shapes.add_table(len(rows), 4, Inches(0.5), Inches(2.0), Inches(12.3), Inches(4.4))
tbl_shape.name = "!!table"
tbl = tbl_shape.table
tblPr = tbl._tbl.tblPr
for a in ("firstRow", "bandRow", "firstCol", "lastRow", "lastCol", "bandCol"): tblPr.set(a, "0")
sid = tblPr.find(qn("a:tableStyleId"))
if sid is not None: sid.text = "{2D5ABB26-0587-4C30-8999-92F81FD0307C}"
widths = [3.9, 2.9, 2.7, 2.8]
for i, w in enumerate(widths): tbl.columns[i].width = Inches(w)
for r_i, row in enumerate(rows):
    tbl.rows[r_i].height = Inches(0.62)
    for c_i, val in enumerate(row):
        cell = tbl.cell(r_i, c_i)
        cell.fill.solid()
        hdr = r_i == 0
        last = c_i == 3
        cell.fill.fore_color.rgb = rgb(NAVY if hdr else (LAV if last else "F3F6FF"))
        if hdr and last: cell.fill.fore_color.rgb = rgb(BLUE)
        cell.vertical_anchor = MSO_ANCHOR.MIDDLE
        cell.margin_left = Inches(0.15)
        tf = cell.text_frame; tf.word_wrap = True
        p = tf.paragraphs[0]; p.alignment = PP_ALIGN.LEFT if c_i == 0 else PP_ALIGN.CENTER
        run = p.add_run(); run.text = val
        set_font(run, 14 if hdr else 15, WHITE if hdr else (BLUE if last else NAVY), hdr or last or c_i == 0, TITLE_FONT if hdr else BODY_FONT)
text(s9, 0.5, 6.6, 12.3, 0.6, "Качественная оценка автора по открытым описаниям сервисов, проверяется на интервью", size=14, color=NAVY)
pic(s9, M + "image6.png", 9.4, 0.3, w=3.6, name="!!deco")
notes(s9, "Сравнение по категориям решений, а не по конкретным компаниям. Оценки качественные и будут уточнены при анализе условий конкретных сервисов.")

# 10. Матрица рисков
s10 = new_slide(None); add_menu(s10, 2)
title(s10, "МАТРИЦА РИСКОВ", w=9)
# сетка 3x3: ось X влияние, Y вероятность
gx, gy, cw, chh = 1.2, 2.35, 1.35, 1.2
levels = ["Низкая", "Средняя", "Высокая"]
cols = [["D9E4FF", "AFC6FF", "7FA1FF"], ["AFC6FF", "7FA1FF", "4A76F8"], ["7FA1FF", "4A76F8", "0C40F6"]]
for r in range(3):          # r=0 верх = высокая вероятность
    for c in range(3):
        prob = 2 - r
        card(s10, gx + c * cw, gy + r * chh, cw - 0.06, chh - 0.06, fill=cols[prob][c], radius=0.08, shadow=False)
for i, lv in enumerate(levels):
    text(s10, gx + i * cw, gy + 3 * chh + 0.02, cw, 0.4, lv, size=13, color=WHITE, align=PP_ALIGN.CENTER)
    text(s10, 0.1, gy + (2 - i) * chh + 0.4, 1.1, 0.4, lv, size=13, color=WHITE, align=PP_ALIGN.RIGHT)
text(s10, gx, gy + 3 * chh + 0.38, 3 * cw, 0.4, "ВЛИЯНИЕ", size=13, color=WHITE, font=TITLE_FONT, align=PP_ALIGN.CENTER)
text(s10, 0.1, gy - 0.42, 2.4, 0.4, "ВЕРОЯТНОСТЬ", size=13, color=WHITE, font=TITLE_FONT)
risks = [("Регуляторный: деньги вправе держать только банк", 2, 2, 1), ("Нет интеграции с платформой цифрового рубля", 2, 2, 2),
         ("Споры и злоупотребления сторон", 1, 1, 3), ("Уязвимость смарт-контрактов", 0, 2, 4),
         ("Недостаточный спрос на старте", 1, 2, 5), ("Утечка персональных данных", 0, 2, 6)]
# позиции кружков: (влияние, вероятность)
pos = {1: (2, 2), 2: (2, 2), 3: (1, 1), 4: (2, 0), 5: (2, 1), 6: (2, 0)}
offs = {1: (-0.28, -0.2), 2: (0.22, 0.2), 3: (0, 0), 4: (-0.28, 0), 5: (0, 0), 6: (0.25, 0)}
for n, (inf, prob) in pos.items():
    cx = gx + inf * cw + cw / 2 - 0.03 + offs[n][0]; cy = gy + (2 - prob) * chh + chh / 2 - 0.03 + offs[n][1]
    circ(s10, cx, cy, 0.5, NAVY, str(n), WHITE, 15)
mit = ["Деньги держит банк, проект управляет условиями", "Пилот с банком-участником, тестовая сеть до подключения", "Приемщик из реестра, автоприемка, рейтинг по отзывам", "Независимый аудит, лимиты сумм в пилоте", "Интервью и пилот в одном сегменте: ремонт", "Шифрование, права администратора, журнал"]
card(s10, 5.8, 2.1, 7.1, 4.9, fill=WHITE)
for i, (r, *_rest) in enumerate(risks):
    y = 2.25 + i * 0.78
    circ(s10, 6.15, y + 0.3, 0.42, NAVY, str(i + 1), WHITE, 14)
    text(s10, 6.5, y - 0.02, 6.3, 0.4, r[0] if isinstance(r, tuple) else r, size=14, color=NAVY, bold=True)
    text(s10, 6.5, y + 0.33, 6.3, 0.4, mit[i], size=13, color=BLUE)
notes(s10, "Основной риск регуляторный: проект не принимает деньги, их удерживает банк или оператор платформы. Остальные риски закрываются аудитом, пилотом и правилами сделки.")

# 11. Технологии
s11 = new_slide(None); add_menu(s11, 3)
title(s11, "ТЕХНОЛОГИЧЕСКИЕ РЕШЕНИЯ", w=9, size=36)
layers = [("ПРИЛОЖЕНИЕ", "Веб и мобильный интерфейс, вход по passkey"), ("СЕРВЕР СДЕЛОК", "API, чаты, уведомления, отзывы и рейтинг"),
          ("ЯДРО ПРАВИЛ", "Этапы, резерв, выплата, споры, сроки, проверка инвариантов"), ("ЖУРНАЛ СДЕЛКИ", "Цепочка хешей, якоря во внешнем источнике"),
          ("ИСПОЛНЕНИЕ", "Смарт-контракт в сети Ethereum, затем платформа цифрового рубля")]
for i, (h, d) in enumerate(layers):
    y = 2.2 + i * 0.98
    card(s11, 0.5, y, 8.0, 0.88, fill=LAV if i < 4 else WHITE)
    text(s11, 0.7, y + 0.06, 2.6, 0.75, h, size=15, color=BLUE, font=TITLE_FONT, anchor=MSO_ANCHOR.MIDDLE)
    text(s11, 3.3, y + 0.06, 5.1, 0.75, d, size=14, color=NAVY, anchor=MSO_ANCHOR.MIDDLE)
pic(s11, A + "phone-exec.png", 9.6, 1.3, h=5.8, name="!!phoneB")
notes(s11, "Правила сделки описаны один раз в ядре и исполняются без изменений как в приложении, так и в смарт-контракте. Расхождение результатов проверяется автоматически.")

# 12. Продукт на телефонах
s12 = new_slide(None); add_menu(s12, 3)
title(s12, "ПРОДУКТ НА ЭКРАНЕ ТЕЛЕФОНА", w=11, size=36)
pic(s12, A + "phone-deal.png", 1.2, 1.95, h=4.85, name="!!phoneC")
pic(s12, A + "phone-wallet.png", 5.0, 1.8, h=5.0, name="!!phoneD")
pic(s12, A + "phone-chat.png", 8.8, 1.95, h=4.85, name="!!phoneE")
for cx, cap in ((1.2, "Сделка по этапам"), (5.0, "Кошелек в цифровых рублях"), (8.8, "Чат и согласование условий")):
    pass
for x0, cap in ((0.75, "Сделка по этапам"), (4.55, "Кошелек в цифровых рублях"), (8.35, "Чат и согласование условий")):
    card(s12, x0, 6.88, 3.2, 0.45, radius=0.3)
    text(s12, x0, 6.88, 3.2, 0.45, cap, size=14, color=NAVY, bold=True, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
pic(s12, M + "image2.png", 11.2, 0.9, h=1.9, name="!!deco")
notes(s12, "Экраны действующего прототипа. Данные демонстрационные, деньги условные.")

# 13. Финмодель
s13 = new_slide(None); add_menu(s13, 4)
title(s13, "ЭКОНОМИКА СДЕЛКИ", w=9)
stats = [("750 ₽", "выручка со сделки", "средний чек 50 000 ₽, комиссия 1,5%"), ("600 ₽", "вклад со сделки", "после расходов на проверки, сеть и поддержку: 150 ₽"), ("500", "сделок в месяц", "безубыточность при расходах 300 000 ₽ в месяц")]
for i, (big, cap, sub) in enumerate(stats):
    x = 0.5 + i * 4.2
    card(s13, x, 2.2, 3.95, 2.6)
    text(s13, x + 0.2, 2.3, 3.6, 1.1, big, size=48, color=BLUE, font=TITLE_FONT)
    text(s13, x + 0.2, 3.4, 3.6, 0.45, cap.upper(), size=15, color=NAVY, font=TITLE_FONT)
    text(s13, x + 0.2, 3.9, 3.6, 0.85, sub, size=14, color=NAVY)
card(s13, 0.5, 5.05, 12.15, 1.55, fill=WHITE)
text(s13, 0.8, 5.15, 11.6, 0.45, "ФОРМУЛА", size=15, color=BLUE, font=TITLE_FONT)
text(s13, 0.8, 5.6, 11.6, 0.95, "Вклад со сделки = чек × комиссия − переменные расходы. Безубыточность = постоянные расходы / вклад со сделки. Рост среднего чека или доли повторных сделок снижает порог.", size=15, color=NAVY)
text(s13, 0.5, 6.85, 12.3, 0.4, "Расчет иллюстративный. Параметры проверяются в пилоте и уточняются с банком-партнером", size=14, color=WHITE)
pic(s13, M + "image5.png", 11.2, 0.25, h=1.9, name="!!deco")
notes(s13, "Модель показывает порядок величин и чувствительность. Комиссия и расходы являются допущениями и будут заменены данными пилота.")

# 14. Roadmap
s14 = new_slide(None); add_menu(s14, 5)
title(s14, "ROADMAP", w=8)
phases = [("ОКТ 2026", "Прототип и тестовая сеть", True), ("НОЯ 2026", "Интервью, обращение в Банк России, спринт 1", False),
          ("I КВ 2027", "Аудит контрактов, юрлицо, банк-партнер", False), ("II КВ 2027", "Пилот: ремонт, 100 сделок", False), ("II ПОЛ 2027", "Подключение к платформе цифрового рубля", False)]
for i, (d, t, done) in enumerate(phases):
    x = 0.5 + i * 2.5
    card(s14, x, 2.4, 2.3, 3.4, fill=(BLUE if done else LAV))
    circ(s14, x + 0.4, 2.85, 0.55, WHITE if done else NAVY, str(i + 1), BLUE if done else WHITE, 15)
    text(s14, x + 0.15, 3.35, 2.0, 0.45, d, size=16, color=WHITE if done else BLUE, font=TITLE_FONT)
    text(s14, x + 0.15, 3.9, 2.0, 1.8, t, size=15, color=WHITE if done else NAVY)
    if i < 4:
        s = s14.shapes.add_shape(MSO_SHAPE.RIGHT_ARROW, Inches(x + 2.3), Inches(4.0), Inches(0.2), Inches(0.35))
        s.fill.solid(); s.fill.fore_color.rgb = rgb(WHITE); s.line.fill.background()
        st = s._element.find(qn("p:style"))
        if st is not None: s._element.remove(st)
text(s14, 0.5, 6.2, 8.5, 0.5, "Этап 1 выполнен, остальные требуют финансирования и партнера", size=16, color=WHITE, bold=True)
pic(s14, M + "image3.png", 10.8, 5.6, h=1.7, name="!!deco")
notes(s14, "Первый этап выполнен. Следующие этапы зависят от финансирования, аудита и партнера из числа банков.")

# 15. Итог
s15 = new_slide(bg_d); add_menu(s15, 5)
pic(s15, M + "image1.png", 0.5, 1.05, w=3.6, name="!!logo")
text(s15, 0.5, 2.5, 8.2, 1.6, "ЧТО НУЖНО ДЛЯ ЗАПУСКА", size=40, color=NAVY, font=TITLE_FONT, spacing=0.9, name="Slide title")
asks = [("АУДИТ", "Независимая проверка кода и контрактов"), ("ПАРТНЕР", "Банк-участник платформы цифрового рубля"), ("ПИЛОТ", "100 сделок в сегменте ремонта")]
for i, (h, d) in enumerate(asks):
    y = 3.7 + i * 0.95
    card(s15, 0.5, y, 7.4, 0.82)
    text(s15, 0.7, y + 0.06, 2.0, 0.7, h, size=16, color=BLUE, font=TITLE_FONT, anchor=MSO_ANCHOR.MIDDLE)
    text(s15, 2.7, y + 0.06, 5.1, 0.7, d, size=15, color=NAVY, anchor=MSO_ANCHOR.MIDDLE)
text(s15, 0.5, 6.6, 8.0, 0.8, [("Гудков Павел Алексеевич", {"bold": True, "size": 15}), "pavlusha220@yandex.ru   +7 995 540-71-20"], size=14, color=NAVY)
pic(s15, A + "phone-deal-front.png", 9.3, 1.5, h=5.7, name="!!phoneF")
pic(s15, M + "image2.png", 8.0, 0.55, h=1.6, name="!!deco")
notes(s15, "Запрос: аудит, партнер из числа банков, пилот. Контакты автора указаны на слайде.")

# ---------------- порядок слайдов ----------------
ids = prs.slides._sldIdLst
els = list(ids)
order = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
# 7 существующих + 8 новых; порядок: 1..7, затем 8..15 (рынок, конкуренты, риски, технологии, продукт, финансы, roadmap, итог)
for e in els: ids.remove(e)
for i in order: ids.append(els[i])

# ---------------- ссылки меню: переход по вкладкам ----------------
all_slides = list(prs.slides)
section_first = {0: all_slides[1], 1: all_slides[3], 2: all_slides[7], 3: all_slides[10], 4: all_slides[12], 5: all_slides[13]}
for sl in all_slides:
    for sh in sl.shapes:
        if sh.name == "!!menu" and sh.shape_type == 6:
            rects = [s for s in sh.shapes if s.shape_type == 1]
            for i, r in enumerate(rects):
                r.click_action.target_slide = section_first[i]
            boxes = [s for s in sh.shapes if s.shape_type == 17]
            for i, b in enumerate(boxes):
                b.click_action.target_slide = section_first[i]

# ---------------- анимированные переходы ----------------
NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main"
MC = "http://schemas.openxmlformats.org/markup-compatibility/2006"
def transition_xml(kind):
    if kind == "morph":
        return ('<mc:AlternateContent xmlns:mc="%s" xmlns:p="%s"><mc:Choice xmlns:p159="http://schemas.microsoft.com/office/powerpoint/2015/09/main" Requires="p159">'
                '<p:transition spd="slow" xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" p14:dur="1500"><p159:morph option="byObject"/></p:transition></mc:Choice>'
                '<mc:Fallback><p:transition spd="slow"><p:fade/></p:transition></mc:Fallback></mc:AlternateContent>') % (MC, NS_P)
    if kind == "push":
        return '<p:transition xmlns:p="%s" spd="slow"><p:push dir="u"/></p:transition>' % NS_P
    return '<p:transition xmlns:p="%s" spd="med"><p:fade/></p:transition>' % NS_P

for i, sl in enumerate(all_slides):
    el = sl._element
    for t in el.findall(qn("p:transition")): el.remove(t)
    kind = "fade" if i == 0 else "morph"
    tx = etree.fromstring(transition_xml(kind))
    anchor = el.find(qn("p:clrMapOvr"))
    if anchor is not None: anchor.addnext(tx)
    else: el.find(qn("p:cSld")).addnext(tx)

prs.save(BASE + "deck/StepPay_Project_Complete.pptx")
print("saved", len(all_slides))
