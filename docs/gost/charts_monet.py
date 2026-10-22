# Графики для документа «Модель монетизации StepPay».
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from PIL import Image

plt.rcParams.update({"font.family": "Liberation Serif", "font.size": 12, "axes.spines.top": False, "axes.spines.right": False, "axes.edgecolor": "#5a6580"})
NAVY, BLUE, MID, LIGHT, GRAY, GREEN, AMBER = "#0a2a7a", "#2f5bea", "#7d9cf2", "#dbe4fb", "#8a94a8", "#1e8a55", "#d98b1c"
OUT = "charts/"
fmt = lambda v: f"{v:g}".replace(".", ",")
def save(fig, name):
    fig.savefig(OUT + name, dpi=200); plt.close(fig)
    Image.open(OUT + name).convert("RGB").quantize(colors=128, method=Image.Quantize.MEDIANCUT).save(OUT + name, optimize=True)

# 1. Выручка по источникам по годам, млн руб.
years = ["1-й год", "2-й год", "3-й год"]
streams = [("Комиссия со сделок", [2.7, 9.0, 18.0], NAVY), ("Подписка Pro для исполнителей", [0.6, 2.4, 5.9], BLUE),
           ("Сборы и гранты", [0.3, 2.2, 5.0], MID), ("Сопровождение споров", [0.03, 0.1, 0.2], GRAY)]
fig, ax = plt.subplots(figsize=(7.4, 4.2))
bottom = [0, 0, 0]
for name, vals, c in streams:
    ax.bar(years, vals, bottom=bottom, color=c, width=0.55, label=name)
    bottom = [b + v for b, v in zip(bottom, vals)]
for i, t in enumerate(bottom):
    ax.text(i, t + 0.6, fmt(round(t, 1)) + " млн руб.", ha="center", weight="bold")
ax.set_ylabel("Выручка, млн руб."); ax.set_ylim(0, 34)
ax.legend(frameon=False, fontsize=10.5, loc="upper left")
fig.tight_layout(); save(fig, "mo1_revenue.png")

# 2. Экономика одной сделки, руб.
fig, ax = plt.subplots(figsize=(7.4, 3.6))
labels = ["Комиссия 1,5 %\nсо сделки 50 000 руб.", "Переменные\nрасходы", "Вклад\nсо сделки"]
ax.bar([0], [750], color=NAVY, width=0.5)
ax.bar([1], [150], bottom=[600], color=AMBER, width=0.5)
ax.bar([2], [600], color=GREEN, width=0.5)
for x, y, t in ((0, 770, "750"), (1, 770, "-150"), (2, 620, "600")):
    ax.text(x, y, t + " руб.", ha="center", weight="bold")
ax.plot([0.25, 0.75], [750, 750], color=GRAY, lw=1, ls="--"); ax.plot([1.25, 1.75], [600, 600], color=GRAY, lw=1, ls="--")
ax.set_xticks([0, 1, 2]); ax.set_xticklabels(labels); ax.set_ylim(0, 900); ax.set_ylabel("Рублей на сделку")
fig.tight_layout(); save(fig, "mo2_unit.png")

# 3. Точка безубыточности
fig, ax = plt.subplots(figsize=(7.4, 3.8))
n = list(range(0, 1001, 50))
ax.plot(n, [x * 600 / 1000 for x in n], color=GREEN, lw=2.4, label="Вклад от сделок")
ax.plot(n, [300] * len(n), color=AMBER, lw=2.4, label="Постоянные расходы 300 тыс. руб.")
ax.scatter([500], [300], s=90, color=NAVY, zorder=3)
ax.annotate("500 сделок в месяц", (500, 300), xytext=(560, 160), arrowprops=dict(arrowstyle="-", color=NAVY), color=NAVY, weight="bold")
ax.set_xlabel("Сделок в месяц"); ax.set_ylabel("Тыс. руб. в месяц"); ax.set_ylim(0, 620)
ax.legend(frameon=False, loc="upper left")
fig.tight_layout(); save(fig, "mo3_breakeven.png")

# 4. Комиссии площадок
fig, ax = plt.subplots(figsize=(7.4, 3.4))
names = ["FL.ru", "Kwork", "YouDo", "StepPay"]
lo = [7, 7.5, 11, 1.5]; hi = [20, 20, 11, 1.5]
y = list(range(len(names)))[::-1]
for yy, a, b, nm in zip(y, lo, hi, names):
    c = NAVY if nm == "StepPay" else GRAY
    if a == b:
        ax.barh(yy, a, color=c, height=0.5); ax.text(a + 0.3, yy, fmt(a) + " %" + (" + 35 руб." if nm == "YouDo" else ""), va="center")
    else:
        ax.barh(yy, b, color=LIGHT, height=0.5); ax.barh(yy, a, color=c, height=0.5)
        ax.text(b + 0.3, yy, f"{fmt(a)}-{fmt(b)} %", va="center")
ax.set_yticks(y); ax.set_yticklabels(names); ax.set_xlim(0, 25); ax.set_xlabel("Комиссия, % от суммы заказа")
fig.tight_layout(); save(fig, "mo4_fees.png")

# 5. Резерв по шагам: сколько денег клиента остается у него
fig, ax = plt.subplots(figsize=(7.4, 3.6))
months = ["Месяц 1", "Месяц 2", "Месяц 3", "Месяц 4"]
full = [300, 180, 120, 30]; stepwise = [120, 60, 90, 30]
x = range(4)
ax.bar([i - 0.2 for i in x], full, width=0.38, color=LIGHT, label="Резерв всей суммы")
ax.bar([i + 0.2 for i in x], stepwise, width=0.38, color=NAVY, label="Резерв только текущего этапа")
for i, v in zip(x, stepwise):
    ax.text(i + 0.2, v + 6, str(v), ha="center", fontsize=11)
for i, v in zip(x, full):
    ax.text(i - 0.2, v + 6, str(v), ha="center", fontsize=11, color="#5a6580")
ax.set_xticks(list(x)); ax.set_xticklabels(months); ax.set_ylabel("В резерве, тыс. руб."); ax.set_ylim(0, 360)
ax.legend(frameon=False, fontsize=10.5, loc="upper right")
fig.tight_layout(); save(fig, "mo5_stepwise.png")
print("ok")
