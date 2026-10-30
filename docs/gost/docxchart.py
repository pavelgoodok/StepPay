# Нативные диаграммы Word: диаграмма строится средствами python-pptx (оформление, данные, встроенная книга Excel),
# затем ее часть переносится в документ docx и вставляется как редактируемая диаграмма, а не картинка.
import copy
from lxml import etree
from docx.opc.constants import CONTENT_TYPE as CT, RELATIONSHIP_TYPE as RT
from docx.opc.packuri import PackURI
from docx.opc.part import Part
from docx.oxml import parse_xml
from docx.shared import Cm, Emu
from pptx import Presentation
from pptx.chart.data import CategoryChartData, XyChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION, XL_LABEL_POSITION, XL_TICK_LABEL_POSITION, XL_MARKER_STYLE
from pptx.util import Pt

FONT = "Times New Roman"
DARK = ("#0A2A7A", "#2F5BEA", "#1E8A55")
_n = [0]


def rgb(h):
    h = h.lstrip("#")
    return RGBColor(int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def new_chart(chart_type, data, width_cm, height_cm):
    """Создает диаграмму во временной презентации и возвращает (chart, graphic_frame)."""
    prs = Presentation()
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    gf = slide.shapes.add_chart(chart_type, 0, 0, Cm(width_cm), Cm(height_cm), data)
    ch = gf.chart
    ch.font.name = FONT
    ch.font.size = Pt(11)
    ch.has_title = False
    # без рамки области диаграммы
    cs = ch._chartSpace
    sp = parse_xml('<c:spPr xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>')
    tx = cs.find('{http://schemas.openxmlformats.org/drawingml/2006/chart}txPr')
    if tx is not None:
        tx.addprevious(sp)
    else:
        cs.find('{http://schemas.openxmlformats.org/drawingml/2006/chart}chart').addnext(sp)
    return ch, gf


def axis_title(axis, text):
    axis.has_title = True
    tf = axis.axis_title.text_frame
    tf.text = text
    for p in tf.paragraphs:
        for r in p.runs:
            r.font.size = Pt(11); r.font.bold = False; r.font.name = FONT


def insert(paragraph, gf, width_cm, height_cm):
    """Переносит часть диаграммы и книгу Excel в пакет docx и вставляет диаграмму в абзац."""
    _n[0] += 1
    n = _n[0]
    doc_part = paragraph.part
    pkg = doc_part.package
    cpart = gf.chart_part
    xml = etree.tostring(cpart._element, xml_declaration=True, encoding="UTF-8", standalone=True)
    xlsx = cpart.chart_workbook.xlsx_part.blob
    x_part = Part(PackURI(f"/word/embeddings/Microsoft_Excel_Sheet{n}.xlsx"), CT.SML_SHEET, xlsx, pkg)
    c_part = Part(PackURI(f"/word/charts/chart{n}.xml"), CT.DML_CHART, b"", pkg)
    rid_x = c_part.relate_to(x_part, RT.PACKAGE)
    root = etree.fromstring(xml)
    ns = {"c": "http://schemas.openxmlformats.org/drawingml/2006/chart", "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}
    for ed in root.findall("c:externalData", ns):
        ed.set("{%s}id" % ns["r"], rid_x)
    c_part._blob = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)
    rid = doc_part.relate_to(c_part, RT.CHART)
    cx, cy = int(Cm(width_cm)), int(Cm(height_cm))
    drawing = parse_xml(
        f'<w:drawing xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
        f'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
        f'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
        f'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" '
        f'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f'<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="{cx}" cy="{cy}"/>'
        f'<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="{1000 + n}" name="Диаграмма {n}"/>'
        f'<wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">'
        f'<c:chart r:id="{rid}"/></a:graphicData></a:graphic></wp:inline></w:drawing>'
    )
    paragraph.add_run()._r.append(drawing)


# ───── типовые диаграммы ─────

def _labels(plot, fmt='0', pos=None, size=11, bold=False):
    plot.has_data_labels = True
    dl = plot.data_labels
    dl.number_format = fmt
    dl.number_format_is_linked = False
    dl.font.size = Pt(size); dl.font.bold = bold; dl.font.name = FONT
    if pos is not None:
        dl.position = pos


def _clean_axes(ch, value_title=None, cat_title=None, vmax=None, vmin=0, gridlines=True, value_fmt=None):
    va = ch.value_axis
    va.has_major_gridlines = gridlines
    if gridlines:
        va.major_gridlines.format.line.color.rgb = rgb("#E3E7F0")
    va.format.line.fill.background()
    if vmax is not None:
        va.maximum_scale = vmax
    if vmin is not None:
        va.minimum_scale = vmin
    if value_fmt:
        va.tick_labels.number_format = value_fmt; va.tick_labels.number_format_is_linked = False
    va.tick_labels.font.size = Pt(10)
    ca = ch.category_axis
    ca.format.line.color.rgb = rgb("#8A94A8")
    ca.tick_labels.font.size = Pt(11)
    ca.has_major_gridlines = False
    if value_title:
        axis_title(va, value_title)
    if cat_title:
        axis_title(ca, cat_title)


def bars(cats, values, colors, horizontal=False, value_title=None, fmt='0', vmax=None, width_cm=15, height_cm=7.5, labels=None, gap=60):
    """Одна серия, каждый столбец своим цветом; labels - свои подписи вместо значений."""
    data = CategoryChartData(number_format=fmt)
    data.categories = cats
    data.add_series("Значение", values)
    kind = XL_CHART_TYPE.BAR_CLUSTERED if horizontal else XL_CHART_TYPE.COLUMN_CLUSTERED
    ch, gf = new_chart(kind, data, width_cm, height_cm)
    ch.has_legend = False
    plot = ch.plots[0]
    plot.gap_width = gap
    plot.vary_by_categories = False
    s = plot.series[0]
    for i, c in enumerate(colors):
        pt = s.points[i]
        pt.format.fill.solid(); pt.format.fill.fore_color.rgb = rgb(c)
    _labels(plot, fmt, XL_LABEL_POSITION.OUTSIDE_END, bold=True)
    if labels:
        for i, t in enumerate(labels):
            tf = s.points[i].data_label.text_frame
            tf.text = t
            for r in tf.paragraphs[0].runs:
                r.font.size = Pt(11); r.font.bold = True; r.font.name = FONT
            s.points[i].data_label.position = XL_LABEL_POSITION.OUTSIDE_END
    _clean_axes(ch, value_title, vmax=vmax, value_fmt=fmt if '.' not in fmt else '0')
    if horizontal:
        ch.category_axis.reverse_order = True
        ch.value_axis.tick_label_position = XL_TICK_LABEL_POSITION.LOW
    return gf


def multi(cats, series, colors, kind, value_title=None, fmt='0', vmax=None, width_cm=15, height_cm=8, legend=True, labels=True, gap=60, overlap=None, hidden=(), texts=None, vmin=0):
    """Несколько серий: столбцы рядом, с накоплением или линии. hidden - номера серий без заливки (основа каскада)."""
    data = CategoryChartData(number_format=fmt)
    data.categories = cats
    for name, vals in series:
        data.add_series(name, vals)
    ch, gf = new_chart(kind, data, width_cm, height_cm)
    stacked = kind in (XL_CHART_TYPE.COLUMN_STACKED, XL_CHART_TYPE.BAR_STACKED)
    plot = ch.plots[0]
    if hasattr(plot, "gap_width"):
        plot.gap_width = gap
    if overlap is not None:
        plot.overlap = overlap
    for i, s in enumerate(plot.series):
        if i in hidden:
            s.format.fill.background(); s.format.line.fill.background()
            continue
        if kind in (XL_CHART_TYPE.LINE, XL_CHART_TYPE.LINE_MARKERS):
            s.format.line.color.rgb = rgb(colors[i]); s.format.line.width = Pt(2.5); s.smooth = False
            s.marker.style = XL_MARKER_STYLE.NONE
        else:
            s.format.fill.solid(); s.format.fill.fore_color.rgb = rgb(colors[i])
        if texts and i in texts:  # свои подписи точек (десятичная запятая, пояснения)
            for j, t in enumerate(texts[i]):
                if not t:
                    continue
                dl = s.points[j].data_label
                tf = dl.text_frame; tf.text = t
                for r in tf.paragraphs[0].runs:
                    r.font.size = Pt(10); r.font.name = FONT
                    if stacked and colors[i].upper() in DARK:
                        r.font.color.rgb = rgb("#FFFFFF")
            continue
        if labels:
            s.data_labels.show_value = True
            s.data_labels.number_format = fmt; s.data_labels.number_format_is_linked = False
            s.data_labels.font.size = Pt(10); s.data_labels.font.name = FONT
    ch.has_legend = legend
    if legend:
        ch.legend.position = XL_LEGEND_POSITION.BOTTOM
        ch.legend.include_in_layout = False
        ch.legend.font.size = Pt(10.5)
        if hidden:  # из легенды убираем служебные серии
            from lxml import etree as et
            leg = ch.legend._element
            for i in hidden:
                le = et.SubElement(leg, "{http://schemas.openxmlformats.org/drawingml/2006/chart}legendEntry")
                idx = et.SubElement(le, "{http://schemas.openxmlformats.org/drawingml/2006/chart}idx"); idx.set("val", str(i))
                de = et.SubElement(le, "{http://schemas.openxmlformats.org/drawingml/2006/chart}delete"); de.set("val", "1")
                leg.remove(le); leg.insert(1, le)
    _clean_axes(ch, value_title, vmax=vmax, vmin=vmin, value_fmt='0')
    if vmin is not None and vmin < 0:  # при отрицательных значениях подписи категорий под осью, а не на нуле
        ch.category_axis.tick_label_position = XL_TICK_LABEL_POSITION.LOW
    if kind in (XL_CHART_TYPE.BAR_STACKED, XL_CHART_TYPE.BAR_CLUSTERED):
        ch.category_axis.reverse_order = True
        ch.value_axis.tick_label_position = XL_TICK_LABEL_POSITION.LOW
    return gf


def scatter(points, colors, x_title, y_title, width_cm=15, height_cm=9.5, xmax=10.5, ymax=10):
    """Карта позиционирования: каждая точка отдельной серией с подписью-названием."""
    data = XyChartData()
    for name, x, y in points:
        s = data.add_series(name)
        s.add_data_point(x, y)
    ch, gf = new_chart(XL_CHART_TYPE.XY_SCATTER, data, width_cm, height_cm)
    ch.has_legend = False
    for i, s in enumerate(ch.plots[0].series):
        s.marker.style = XL_MARKER_STYLE.CIRCLE
        s.marker.size = 14 if points[i][0] == "StepPay" else 10
        s.marker.format.fill.solid(); s.marker.format.fill.fore_color.rgb = rgb(colors[i])
        s.marker.format.line.color.rgb = rgb("#FFFFFF")
        s.format.line.fill.background()
        dl = s.points[0].data_label
        tf = dl.text_frame; tf.text = points[i][0]
        for r in tf.paragraphs[0].runs:
            r.font.size = Pt(11 if points[i][0] != "StepPay" else 12); r.font.bold = points[i][0] == "StepPay"; r.font.name = FONT
        dl.position = XL_LABEL_POSITION.RIGHT
    for ax, t, mx in ((ch.value_axis, y_title, ymax), (ch.category_axis, x_title, xmax)):
        ax.minimum_scale = 0; ax.maximum_scale = mx
        ax.major_unit = mx / 2
        ax.has_major_gridlines = True
        ax.major_gridlines.format.line.color.rgb = rgb("#C9D3EA")
        ax.tick_label_position = XL_TICK_LABEL_POSITION.NONE
        ax.format.line.color.rgb = rgb("#8A94A8")
        axis_title(ax, t)
    return gf


def lines_xy(series, colors, x_title, y_title, width_cm=15, height_cm=8, xmax=None, ymax=None):
    """Линии по точкам (x, y): точка безубыточности."""
    data = XyChartData()
    for name, pts in series:
        s = data.add_series(name)
        for x, y in pts:
            s.add_data_point(x, y)
    ch, gf = new_chart(XL_CHART_TYPE.XY_SCATTER_LINES_NO_MARKERS, data, width_cm, height_cm)
    for i, s in enumerate(ch.plots[0].series):
        s.format.line.color.rgb = rgb(colors[i]); s.format.line.width = Pt(2.5); s.smooth = False
    ch.has_legend = True
    ch.legend.position = XL_LEGEND_POSITION.BOTTOM; ch.legend.include_in_layout = False; ch.legend.font.size = Pt(10.5)
    for ax, t, mx in ((ch.value_axis, y_title, ymax), (ch.category_axis, x_title, xmax)):
        ax.minimum_scale = 0
        if mx:
            ax.maximum_scale = mx
        ax.has_major_gridlines = ax is ch.value_axis
        if ax.has_major_gridlines:
            ax.major_gridlines.format.line.color.rgb = rgb("#E3E7F0")
        ax.tick_labels.font.size = Pt(10)
        axis_title(ax, t)
    return gf
