# Графики для аналитической записки о проблеме предоплаты (данные и источники перечислены в записке).
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker

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
