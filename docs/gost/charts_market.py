# Графики и схемы для документа «Анализ рынка StepPay».
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Circle, FancyBboxPatch, FancyArrowPatch
from PIL import Image

plt.rcParams.update({"font.family": "Liberation Serif", "font.size": 12, "axes.spines.top": False, "axes.spines.right": False, "axes.edgecolor": "#5a6580"})
NAVY, BLUE, MID, LIGHT, GRAY, RED, GREEN, AMBER = "#0a2a7a", "#2f5bea", "#7d9cf2", "#dbe4fb", "#8a94a8", "#c0392b", "#1e8a55", "#d98b1c"
OUT = "charts/"
def save(fig, name):
    fig.savefig(OUT + name, dpi=200)
    plt.close(fig)
    im = Image.open(OUT + name).convert("RGB").quantize(colors=128, method=Image.Quantize.MEDIANCUT)
    im.save(OUT + name, optimize=True)

# 1. TAM / SAM / SOM
fig, ax = plt.subplots(figsize=(7.4, 4.6))
ax.set_aspect("equal"); ax.axis("off")
ax.add_patch(Circle((0, 0), 3.0, color=LIGHT)); ax.add_patch(Circle((0, -0.9), 2.05, color="#4f74e6")); ax.add_patch(Circle((0, -1.9), 1.0, color=NAVY))
ax.text(0, 2.35, "TAM  около 2,54 трлн руб. в год", ha="center", fontsize=13, weight="bold", color=NAVY)
ax.text(0, 1.95, "услуги по ремонту и строительству,\nгранты, краудфандинг", ha="center", va="top", fontsize=10.5, color=NAVY)
ax.text(0, 0.15, "SAM  около 306 млрд руб.", ha="center", fontsize=13, weight="bold", color="white")
ax.text(0, -0.2, "дома с нуля, ремонт под ключ,\nгранты и сборы", ha="center", va="top", fontsize=10, color="white")
ax.text(0, -1.9, "SOM", ha="center", va="center", fontsize=13, weight="bold", color="white")
ax.set_xlim(-5.2, 5.6); ax.set_ylim(-3.2, 3.2)
ax.text(3.35, -2.45, "SOM, оборот сделок в год:\nконсервативный 3,1 млрд руб.\nбазовый 15,3 млрд руб.\nцелевой 50 млрд руб. (5-й год)", fontsize=10.5, color=NAVY)
ax.annotate("", xy=(0.95, -2.1), xytext=(3.3, -2.05), arrowprops=dict(arrowstyle="-", color=NAVY, lw=1))
fig.tight_layout(); save(fig, "m1_tam.png")

# 2. Доходы и число самозанятых
fig, ax = plt.subplots(figsize=(7.2, 3.5))
lab = ["2024", "2025"]; inc = [2.2, 3.0]
b = ax.bar(lab, inc, color=[MID, NAVY], width=0.45)
for bb, v in zip(b, inc):
    ax.text(bb.get_x() + bb.get_width() / 2, v + 0.06, f"{v:.1f}".replace(".", ",") + " трлн руб.", ha="center")
ax.set_ylabel("Доходы самозанятых, трлн руб."); ax.set_ylim(0, 3.6)
ax.text(1.35, 1.1, "рост на 38,6 %\nчеков: 1,5 → 2,5 млрд\nсредний чек: 1 478 → 1 218 руб.", fontsize=10.5, color=NAVY)
ax.set_xlim(-0.6, 2.4)
fig.tight_layout(); save(fig, "m2_selfemployed.png")

# 3. Схема участников и потоков денег
fig, ax = plt.subplots(figsize=(7.6, 4.2)); ax.axis("off"); ax.set_xlim(0, 10); ax.set_ylim(0, 5.9)
def box(x, y, w, h, title, sub, fc, tc="white"):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.02,rounding_size=0.18", fc=fc, ec="none"))
    ax.text(x + w / 2, y + h * 0.62, title, ha="center", va="center", fontsize=12, weight="bold", color=tc)
    ax.text(x + w / 2, y + h * 0.28, sub, ha="center", va="center", fontsize=9.5, color=tc)
def arrow(x1, y1, x2, y2, txt, dy=0.18, c=NAVY):
    ax.add_patch(FancyArrowPatch((x1, y1), (x2, y2), arrowstyle="-|>", mutation_scale=14, color=c, lw=1.6))
    ax.text((x1 + x2) / 2, (y1 + y2) / 2 + dy, txt, ha="center", fontsize=9.5, color=c)
box(0.2, 3.6, 2.6, 1.5, "Заказчик", "грантодатель, спонсоры", LIGHT, NAVY)
box(3.7, 3.6, 2.6, 1.5, "Резерв", "цифровые рубли\nна смарт-контракте", NAVY)
box(7.2, 3.6, 2.6, 1.5, "Исполнитель", "самозанятый, ИП,\nавтор проекта", LIGHT, NAVY)
box(3.7, 0.5, 2.6, 1.4, "Приемщик", "независимый,\nиз реестра", MID)
box(0.2, 0.5, 2.6, 1.4, "Банк", "кошелек цифрового\nрубля", LIGHT, NAVY)
box(7.2, 0.5, 2.6, 1.4, "StepPay", "условия, этапы,\nжурнал, споры", BLUE)
arrow(2.8, 4.55, 3.7, 4.55, "резерв")
arrow(6.3, 4.55, 7.2, 4.55, "", c=GREEN)
ax.text(6.75, 5.25, "выплата за\nпринятый этап", ha="center", fontsize=9.5, color=GREEN)
arrow(3.7, 3.95, 2.8, 3.95, "возврат\nостатка", dy=-0.62, c=AMBER)
arrow(5.0, 1.9, 5.0, 3.6, "", c=MID)
ax.text(5.12, 2.6, "решение\nпо спору", fontsize=9.5, color="#4f74e6")
ax.text(5.55, 2.65, "", fontsize=9)
arrow(1.5, 1.9, 1.5, 3.6, "", c=GRAY)
ax.text(1.62, 2.65, "кошелек", fontsize=9.5, color=GRAY)
arrow(8.5, 1.9, 8.5, 3.6, "", c=GRAY)
ax.text(8.62, 2.65, "условия\nи журнал", fontsize=9.5, color=GRAY)
fig.tight_layout(); save(fig, "m3_scheme.png")

# 4. Карта позиционирования конкурентов
fig, ax = plt.subplots(figsize=(7.4, 4.8))
pts = [("Профи.ру", 0.8, 2.2, GRAY), ("Авито Услуги", 1.5, 3.4, GRAY), ("YouDo", 3.4, 2.4, MID), ("Kwork", 5.2, 1.4, MID), ("FL.ru", 5.6, 2.3, MID),
       ("Эскроу в ИЖС", 6.6, 4.4, BLUE), ("Planeta.ru", 2.4, 6.2, GRAY), ("Отчетность\nпо грантам", 3.6, 7.2, GRAY), ("StepPay", 8.7, 8.4, NAVY)]
for n, x, y, c in pts:
    ax.scatter(x, y, s=260 if n == "StepPay" else 140, color=c, zorder=3, edgecolor="white", linewidth=1.5)
    ax.text(x + 0.25, y + 0.18, n, fontsize=11 if n != "StepPay" else 12.5, weight="bold" if n == "StepPay" else "normal", color=NAVY if n == "StepPay" else "#1d2433")
ax.axhline(5, color="#c9d3ea", lw=1); ax.axvline(5, color="#c9d3ea", lw=1)
ax.set_xlim(0, 10.5); ax.set_ylim(0, 10)
ax.set_xlabel("Защита денег: резерв до приемки и выплата по этапам →")
ax.set_ylabel("Охват: любые стороны, проекты и гранты →")
ax.set_xticks([]); ax.set_yticks([])
fig.tight_layout(); save(fig, "m4_positioning.png")

# 5. Матрица рисков
risks = {"R1": (3, 5), "R2": (4, 4), "R3": (3, 4), "R4": (4, 3), "R5": (2, 4), "R6": (3, 3), "R7": (2, 5), "R8": (3, 2), "R9": (2, 3)}
fig, ax = plt.subplots(figsize=(7.0, 5.0))
for p in range(1, 6):
    for i in range(1, 6):
        s = p * i
        c = "#d9efe2" if s <= 4 else "#fbecc7" if s <= 9 else "#f6d0c4" if s <= 14 else "#e9a597"
        ax.add_patch(plt.Rectangle((i - 0.5, p - 0.5), 1, 1, fc=c, ec="white", lw=2))
from collections import defaultdict
cells = defaultdict(list)
for k, (p, i) in risks.items():
    cells[(p, i)].append(k)
for (p, i), ks in cells.items():
    ax.text(i, p, "\n".join(ks) if len(ks) < 3 else ", ".join(ks), ha="center", va="center", fontsize=12, weight="bold", color=NAVY)
ax.set_xticks(range(1, 6)); ax.set_yticks(range(1, 6))
ax.set_xticklabels(["1\nнизкое", "2", "3\nсреднее", "4", "5\nкритичное"]); ax.set_yticklabels(["1 редко", "2", "3 возможно", "4", "5 почти\nнаверняка"])
ax.set_xlabel("Влияние на проект"); ax.set_ylabel("Вероятность")
ax.set_xlim(0.5, 5.5); ax.set_ylim(0.5, 5.5)
for s in ax.spines.values(): s.set_visible(False)
fig.tight_layout(); save(fig, "m5_risks.png")

# 6. Источники средств для проектов и грантов
fig, ax = plt.subplots(figsize=(7.2, 2.9))
names = ["Инвестиционные платформы", "Фонд президентских грантов", "Planeta.ru (2024)"]
vals = [23.66, 9.5, 2.0]
y = list(range(len(names)))[::-1]
ax.barh(y, vals, color=[NAVY, BLUE, MID], height=0.55)
for yy, v in zip(y, vals):
    ax.text(v + 0.4, yy, f"{v:g}".replace(".", ",") + " млрд руб.", va="center")
ax.set_yticks(y); ax.set_yticklabels(names); ax.set_xlim(0, 31); ax.set_xlabel("Объем за год, млрд руб.")
fig.tight_layout(); save(fig, "m6_funding.png")
print("ok")
