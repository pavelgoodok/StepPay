# Графики для аналитической записки о проблеме предоплаты (данные и источники перечислены в записке).
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker
from PIL import Image

plt.rcParams.update({"font.family": "Liberation Serif", "font.size": 12, "axes.spines.top": False, "axes.spines.right": False, "axes.edgecolor": "#5a6580", "axes.labelcolor": "#1d2433", "xtick.color": "#1d2433", "ytick.color": "#1d2433"})
NAVY, BLUE, GRAY, LIGHT = "#0a2a7a", "#2f5bea", "#8a94a8", "#c9d3ea"
OUT = "charts/"

def fmt(v):
    return f"{v:.1f}".replace(".", ",")

# Рисунок 1: операции без добровольного согласия клиентов
years = ["2023", "2024", "2025"]
vol = [15.8, 27.5, 29.3]
ret = [8.7, 9.9, 5.9]
fig, ax = plt.subplots(figsize=(7.2, 3.9), dpi=200)
bars = ax.bar(years, vol, color=[LIGHT, BLUE, NAVY], width=0.55)
for b, v in zip(bars, vol):
    ax.text(b.get_x() + b.get_width() / 2, v + 0.6, fmt(v), ha="center", va="bottom", fontsize=12)
ax.set_ylabel("Объем операций, млрд руб.")
ax.set_ylim(0, 36)
ax2 = ax.twinx()
ax2.plot(years, ret, color="#c0392b", marker="o", linewidth=2)
for i, (x, v) in enumerate(zip(years, ret)):
    up = i == 0  # над точкой, чтобы не наложиться на подпись столбца
    ax2.text(x, v + 0.6 if up else v - 1.1, fmt(v) + " %", ha="center", va="bottom" if up else "top", color="#c0392b", fontsize=11, bbox=dict(boxstyle="round,pad=0.2", fc="white", ec="none", alpha=0.9))
ax2.set_ylabel("Доля возвращенных средств, %", color="#c0392b")
ax2.set_ylim(0, 14)
ax2.spines["right"].set_visible(True)
ax2.tick_params(axis="y", colors="#c0392b")
fig.tight_layout(); fig.savefig(OUT + "fig1_fraud.png"); plt.close(fig)

# Рисунок 2: структура нарушений при исполнении федерального бюджета за 2025 год
cats = ["Субсидии юридическим лицам", "Прочие нарушения", "Государственные задания\nи функции органов власти", "Государственные закупки"]
vals = [354.7, 580.2 - 354.7 - 63.3 - 31.3, 63.3, 31.3]
fig, ax = plt.subplots(figsize=(7.2, 3.4), dpi=200)
y = range(len(cats))[::-1]
b = ax.barh(list(y), vals, color=[NAVY, GRAY, BLUE, LIGHT], height=0.6)
for yy, v in zip(y, vals):
    ax.text(v + 6, yy, f"{fmt(v)} ({v / 580.2 * 100:.0f} %)".replace(".", ","), va="center", fontsize=11)
ax.set_yticks(list(y)); ax.set_yticklabels(cats)
ax.set_xlabel("Объем нарушений, млрд руб. (всего 580,2)")
ax.set_xlim(0, 460)
fig.tight_layout(); fig.savefig(OUT + "fig2_budget.png"); plt.close(fig)

# Рисунок 3: число плательщиков налога на профессиональный доход
lab = ["Конец 2024", "Конец 2025", "Август 2026"]
sz = [15.427 / 1.268, 15.427, 17.3]
fig, ax = plt.subplots(figsize=(7.2, 3.4), dpi=200)
bars = ax.bar(lab, sz, color=[LIGHT, BLUE, NAVY], width=0.55)
for bb, v in zip(bars, sz):
    ax.text(bb.get_x() + bb.get_width() / 2, v + 0.3, fmt(v), ha="center", va="bottom")
ax.set_ylabel("Самозанятые, млн человек"); ax.set_ylim(0, 20.5)
fig.tight_layout(); fig.savefig(OUT + "fig3_selfemployed.png"); plt.close(fig)

# Рисунок 4: конкурс Фонда президентских грантов, 2025 год
fig, ax = plt.subplots(figsize=(7.2, 2.6), dpi=200)
ax.barh([1], [11000], color=LIGHT, height=0.5); ax.barh([0], [1640], color=NAVY, height=0.5)
ax.text(11000 + 150, 1, "около 11 000", va="center"); ax.text(1640 + 150, 0, "1 640 (около 15 %)", va="center")
ax.set_yticks([1, 0]); ax.set_yticklabels(["Подано заявок", "Поддержано проектов"])
ax.set_xlim(0, 13800); ax.set_xlabel("Количество проектов")
ax.xaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda v, p: f"{int(v):,}".replace(",", " ")))
fig.tight_layout(); fig.savefig(OUT + "fig4_grants.png"); plt.close(fig)
print("ok")

# ───── новые рисунки: две стороны проблемы предоплаты ─────
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
GREEN, AMBER = "#1e8a55", "#d98b1c"

# Неплатежи контрагентов как главное ограничение бизнеса (РСПП, 2025)
fig, ax = plt.subplots(figsize=(7.2, 3.7), dpi=200)
q = ["I кв.", "II кв.", "III кв.", "IV кв."]; v = [27, 26, 39, 42]
ax.axhspan(22, 36, color="#eef1f8", zorder=0); ax.text(-0.38, 34.2, "диапазон 2024 года: 22-36 %", ha="left", fontsize=10.5, color="#5a6580")
bars = ax.bar(q, v, color=[MID if i < 2 else NAVY for i in range(4)] if False else [LIGHT, LIGHT, BLUE, NAVY], width=0.55, zorder=2)
for b, x in zip(bars, v):
    ax.text(b.get_x() + b.get_width() / 2, x + 0.8, f"{x} %", ha="center", fontsize=12, weight="bold")
ax.set_ylabel("Доля компаний, %"); ax.set_ylim(0, 50)
fig.tight_layout(); fig.savefig(OUT + "fig5_nonpay.png"); plt.close(fig)

# ИЖС: подрядчики и авансы
fig, ax = plt.subplots(figsize=(7.2, 2.6), dpi=200)
nm = ["Льготные заемщики, не получившие\nдом (подрядчик исчез или банкрот),\nданные Банка России", "Пострадавшие от недобросовестных\nподрядчиков, оценка Госдумы"]
vv = [5, 20]
yy = [1, 0]
ax.barh(yy, vv, color=[NAVY, "#c0392b"], height=0.55)
for y_, x_, t in zip(yy, vv, ["около 5 тыс.", "более 20 тыс."]):
    ax.text(x_ + 0.3, y_, t, va="center", fontsize=12)
ax.set_yticks(yy); ax.set_yticklabels(nm, fontsize=10.5); ax.set_xlim(0, 26); ax.set_xlabel("Тысяч человек")
fig.tight_layout(); fig.savefig(OUT + "fig6_izhs.png"); plt.close(fig)

# Схема дилеммы предоплаты
fig, ax = plt.subplots(figsize=(7.4, 3.5), dpi=200); ax.axis("off"); ax.set_xlim(0, 10); ax.set_ylim(0, 4.8)
def bx(x, y, w, h, t, s, fc, tc):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.02,rounding_size=0.15", fc=fc, ec="none"))
    ax.text(x + w / 2, y + h * 0.66, t, ha="center", va="center", fontsize=12.5, weight="bold", color=tc)
    ax.text(x + w / 2, y + h * 0.3, s, ha="center", va="center", fontsize=10, color=tc)
bx(0.2, 2.6, 4.5, 1.9, "Оплата вперед (аванс)", "деньги у исполнителя до результата", LIGHT, NAVY)
bx(5.3, 2.6, 4.5, 1.9, "Оплата после сдачи", "работа выполнена до получения денег", LIGHT, NAVY)
bx(0.2, 0.2, 4.5, 1.7, "Рискует заказчик", "работа не начата, сорвана,\nисполнитель исчез", "#f6d0c4", "#7a1f12")
bx(5.3, 0.2, 4.5, 1.7, "Рискует исполнитель", "заказчик не платит,\nзадерживает или занижает оплату", "#fbecc7", "#6b4300")
for x in (2.45, 7.55):
    ax.add_patch(FancyArrowPatch((x, 2.6), (x, 1.9), arrowstyle="-|>", mutation_scale=16, color=NAVY, lw=1.8))
fig.tight_layout(); fig.savefig(OUT + "fig7_dilemma.png"); plt.close(fig)

for n in ("fig5_nonpay.png", "fig6_izhs.png", "fig7_dilemma.png"):
    im = Image.open(OUT + n).convert("RGB").quantize(colors=96, method=Image.Quantize.MEDIANCUT); im.save(OUT + n, optimize=True)
print("ok2")
