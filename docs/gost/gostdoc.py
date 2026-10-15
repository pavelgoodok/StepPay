# Библиотека оформления документов по требованиям ЕСПД (ГОСТ 19.101, 19.104, 19.105, 19.106):
# А4, поля 30/15/20/20 мм, Times New Roman 14, интервал 1,5, абзацный отступ 1,25 см,
# номер страницы вверху по центру, титульный лист без номера, нумерация разделов арабскими цифрами.
import os, re, subprocess, tempfile
from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH as AL, WD_BREAK, WD_TAB_ALIGNMENT, WD_TAB_LEADER
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt

FONT = "Times New Roman"


def _font(run, size=14, bold=False, italic=False):
    run.font.name = FONT
    run._element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
    run.font.size = Pt(size)
    run.bold = bold
    run.italic = italic


class Doc:
    def __init__(self):
        self.d = Document()
        self.headings = []  # (level, text)
        self.table_no = 0
        st = self.d.styles["Normal"]
        st.font.name = FONT
        st.font.size = Pt(14)
        st.element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
        s = self.d.sections[0]
        s.page_height, s.page_width = Cm(29.7), Cm(21.0)
        s.left_margin, s.right_margin, s.top_margin, s.bottom_margin = Cm(3.0), Cm(1.5), Cm(2.0), Cm(2.0)
        s.header_distance = Cm(1.0)

    # ───── абзацы ─────
    def p(self, text="", size=14, bold=False, italic=False, align=AL.JUSTIFY, indent=True, after=0, before=0, line=1.5, keep=False):
        para = self.d.add_paragraph()
        pf = para.paragraph_format
        pf.alignment = align
        pf.line_spacing = line
        pf.space_after, pf.space_before = Pt(after), Pt(before)
        if indent:
            pf.first_line_indent = Cm(1.25)
        if keep:
            pf.keep_with_next = True
        self._runs(para, text, size, bold, italic)
        return para

    def _runs(self, para, text, size, bold, italic):
        # **жирный** внутри текста
        for i, part in enumerate(re.split(r"\*\*(.+?)\*\*", text)):
            if part:
                _font(para.add_run(part), size, bold or i % 2 == 1, italic)

    def center(self, text, size=14, bold=False, after=0, before=0, line=1.5):
        return self.p(text, size, bold, align=AL.CENTER, indent=False, after=after, before=before, line=line)

    def bullet(self, text, size=14, level=0):
        para = self.d.add_paragraph()
        pf = para.paragraph_format
        pf.alignment = AL.JUSTIFY
        pf.line_spacing = 1.5
        pf.left_indent = Cm(1.25 + 0.75 * level + 0.5)
        pf.first_line_indent = Cm(-0.5)
        self._runs(para, "- " + text, size, False, False)
        return para

    def code(self, text):
        for line in text.strip("\n").split("\n"):
            para = self.d.add_paragraph()
            pf = para.paragraph_format
            pf.line_spacing = 1.0
            pf.left_indent = Cm(1.25)
            pf.space_after = Pt(0)
            r = para.add_run(line)
            r.font.name = "Courier New"
            r.font.size = Pt(11)
        self.d.add_paragraph().paragraph_format.space_after = Pt(0)

    # ───── заголовки ─────
    def h1(self, num, text, newpage=False):
        if newpage:
            self.pagebreak()
        label = f"{num} {text.upper()}" if num else text.upper()
        self.headings.append((1, label))
        para = self.p(label, bold=True, indent=True, after=6, before=6, keep=True, align=AL.LEFT)
        para.paragraph_format.first_line_indent = Cm(1.25)
        return para

    def h2(self, num, text):
        label = f"{num} {text}"
        self.headings.append((2, label))
        return self.p(label, bold=True, indent=True, after=3, before=6, keep=True, align=AL.LEFT)

    def h3(self, num, text):
        return self.p(f"{num} {text}", bold=True, italic=False, indent=True, after=0, before=3, keep=True, align=AL.LEFT)

    def appendix(self, letter, kind, title):
        self.pagebreak()
        label = f"ПРИЛОЖЕНИЕ {letter}"
        self.headings.append((1, f"{label} {title}"))
        self.center(label, bold=True, line=1.15)
        self.center(f"({kind})", line=1.15)
        self.center(title, bold=True, after=8, line=1.15)

    def pagebreak(self):
        self.d.add_paragraph().add_run().add_break(WD_BREAK.PAGE)

    # ───── таблицы ─────
    def table(self, caption, headers, rows, widths_cm, size=11):
        self.table_no += 1
        self.p(f"Таблица {self.table_no} - {caption}", size=14, indent=False, align=AL.LEFT, after=3, before=6, line=1.15, keep=True)
        t = self.d.add_table(rows=1, cols=len(headers))
        t.style = "Table Grid"
        t.alignment = WD_TABLE_ALIGNMENT.CENTER
        t.autofit = False
        lay = OxmlElement("w:tblLayout")
        lay.set(qn("w:type"), "fixed")
        t._tbl.tblPr.append(lay)
        for i, w in enumerate(widths_cm):
            t.columns[i].width = Cm(w)
        hdr = t.rows[0]
        trpr = hdr._tr.get_or_add_trPr()
        th = OxmlElement("w:tblHeader")
        th.set(qn("w:val"), "true")
        trpr.append(th)
        for i, h in enumerate(headers):
            self._cell(hdr.cells[i], h, size, True, AL.CENTER, widths_cm[i])
        for row in rows:
            cells = t.add_row().cells
            for i, v in enumerate(row):
                self._cell(cells[i], v, size, False, AL.LEFT, widths_cm[i])
        for r in t.rows:  # строки не разрываются между страницами
            cant = OxmlElement("w:cantSplit")
            cant.set(qn("w:val"), "true")
            r._tr.get_or_add_trPr().append(cant)
        self.d.add_paragraph().paragraph_format.space_after = Pt(2)
        return t

    def _cell(self, cell, text, size, bold, align, width):
        cell.width = Cm(width)
        para = cell.paragraphs[0]
        para.paragraph_format.alignment = align
        para.paragraph_format.line_spacing = 1.0
        para.paragraph_format.space_after = Pt(0)
        lines = str(text).split("\n")
        for i, line in enumerate(lines):
            if i:
                para = cell.add_paragraph()
                para.paragraph_format.line_spacing = 1.0
                para.paragraph_format.space_after = Pt(0)
                para.paragraph_format.alignment = align
            self._runs(para, line, size, bold, False)

    # ───── служебные страницы ─────
    total = "[N]"

    def approval_and_title(self, org, system_name, doc_kind, designation, approver_title, year, place, author=""):
        d = self.d
        # титульный лист
        self.center(org, line=1.15)
        for _ in range(6):
            self.center("", line=1.15)
        self.center(system_name.upper(), bold=True, line=1.3)
        self.center(doc_kind, bold=True, line=1.3, before=6)
        self.center(designation, line=1.3, before=12)
        self.center(f"Листов {self.total}", line=1.3, before=6)
        if author:
            self.center("", line=1.15)
            self.center("Разработчик", line=1.3)
            for ln in author.split("\n"):
                self.center(ln, line=1.3)
        for _ in range(7 if author else 10):
            self.center("", line=1.15)
        self.center(f"{place} {year}".strip(), line=1.15)
        # новая секция: нумерация страниц вверху по центру, со второй страницы
        sec = d.add_section(WD_SECTION.NEW_PAGE)
        sec.header.is_linked_to_previous = False
        hp = sec.header.paragraphs[0]
        hp.paragraph_format.alignment = AL.CENTER
        self._field(hp, "PAGE")
        sectPr = sec._sectPr
        pg = OxmlElement("w:pgNumType")
        pg.set(qn("w:start"), "2")
        sectPr.append(pg)
        # у первой секции колонтитул пустой
        d.sections[0].header.is_linked_to_previous = False

    def _field(self, para, code):
        r = para.add_run()
        _font(r, 12)
        for kind, txt in (("begin", None), (None, code), ("end", None)):
            if kind:
                el = OxmlElement("w:fldChar")
                el.set(qn("w:fldCharType"), kind)
                r._r.append(el)
            else:
                it = OxmlElement("w:instrText")
                it.set(qn("xml:space"), "preserve")
                it.text = txt
                r._r.append(it)

    def toc(self, entries, pages):
        self.center("СОДЕРЖАНИЕ", bold=True, after=8)
        for level, text in entries:
            para = self.d.add_paragraph()
            pf = para.paragraph_format
            pf.line_spacing = 1.15
            pf.space_after = Pt(2)
            pf.left_indent = Cm(0.0 if level == 1 else 0.8)
            pf.tab_stops.add_tab_stop(Cm(16.4), WD_TAB_ALIGNMENT.RIGHT, WD_TAB_LEADER.DOTS)
            _font(para.add_run(text), 13 if level == 1 else 12, level == 1 and False)
            _font(para.add_run("\t" + str(pages.get(text, ""))), 13 if level == 1 else 12)
        self.pagebreak()

    def change_sheet(self):
        self.pagebreak()
        self.center("ЛИСТ РЕГИСТРАЦИИ ИЗМЕНЕНИЙ", bold=True, after=8)
        heads = ["Изм.", "Номера листов (страниц)\nизмененных / замененных / новых / аннулированных", "Всего листов (страниц) в докум.", "№ докум.", "Входящий № сопроводит. докум. и дата", "Подп.", "Дата"]
        t = self.d.add_table(rows=1, cols=len(heads))
        t.style = "Table Grid"
        t.autofit = False
        w = [1.2, 5.4, 2.2, 1.6, 3.2, 1.4, 1.4]
        for i, h in enumerate(heads):
            self._cell(t.rows[0].cells[i], h, 10, True, AL.CENTER, w[i])
        for _ in range(14):
            cells = t.add_row().cells
            for i in range(len(heads)):
                self._cell(cells[i], "", 10, False, AL.LEFT, w[i])


def build(make, out_base, passes=2):
    """Два прохода: сначала без номеров страниц в содержании, затем с номерами, найденными в готовом PDF."""
    pages = {"__total__": "[N]"}
    for n in range(passes):
        doc = make(pages)
        path = out_base + ".docx"
        doc.d.save(path)
        outdir = os.path.dirname(path) or "."
        subprocess.run(["soffice", "--headless", "--convert-to", "pdf", "--outdir", outdir, path], check=True, capture_output=True, timeout=180)
        pdf = out_base + ".pdf"
        txt = subprocess.run(["pdftotext", "-layout", pdf, "-"], capture_output=True, text=True).stdout
        sheets = txt.split("\f")
        found = {}
        # содержание занимает страницы сразу после титула: ищем заголовки после страницы с "СОДЕРЖАНИЕ"
        start = next((i for i, s in enumerate(sheets) if "СОДЕРЖАНИЕ" in s), 0)
        body_start = start
        while body_start < len(sheets) and sheets[body_start].count("....") > 3:
            body_start += 1
        for level, text in doc.headings:
            key = re.sub(r"\s+", " ", text)
            if text.startswith("ПРИЛОЖЕНИЕ"):
                key = " ".join(key.split(" ")[:2])
            for i in range(body_start, len(sheets)):
                flat = re.sub(r"\s+", " ", sheets[i])
                if key in flat:
                    found[text] = i + 1  # физическая страница: нумерация идет с 1, титульный лист занимает 1
                    break
        found["__total__"] = len(sheets) - 1
        pages = found
    return out_base + ".docx", out_base + ".pdf", len(sheets) - 1
