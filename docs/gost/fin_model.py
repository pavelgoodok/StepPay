# Финансовая модель StepPay как продукта Банка ВТБ: исходные данные отчетности (РСБУ) и допущения.
# Расчет здесь повторяет формулы книги Excel (build_finxlsx.py) и дает числа для пояснительной записки.

# Публикуемая отчетность Банка ВТБ (ПАО) по РСБУ, тыс. руб. Баланс на конец периода.
# 2022 и 2023: отчетность за 2023 год; 2024 и 2025: отчетность за 2025 год;
# первое полугодие 2025 и 2026 года: отчетность за первое полугодие 2026 года.
PERIODS = ["2022", "2023", "2024", "2025", "1 пол. 2025", "1 пол. 2026"]
VTB = [
    ("Всего активов", [20_631_984_096, 25_770_545_645, 33_033_189_217, 33_501_601_747, None, 35_631_386_401]),
    ("Вклады (средства) физических лиц", [6_219_071_250, 8_215_738_732, 12_478_944_333, 14_204_311_703, None, 14_160_953_244]),
    ("Всего источников собственных средств", [780_613_660, 1_184_211_537, 2_154_609_808, 2_371_880_458, None, 2_651_381_474]),
    ("Процентные доходы", [1_601_553_540, 2_054_485_001, 3_793_797_052, 4_633_876_226, 2_429_840_541, 2_051_250_750]),
    ("Чистые процентные доходы", [271_551_725, 529_020_665, 303_601_729, 296_545_947, 85_541_761, 316_829_880]),
    ("Комиссионные доходы", [156_767_423, 183_896_429, 280_065_421, 346_055_959, 159_357_242, 192_530_625]),
    ("Комиссионные расходы", [39_413_168, 36_269_014, 69_140_552, 67_968_381, 33_502_756, 35_134_578]),
    ("Чистые доходы (расходы)", [-483_928_390, 809_321_719, 1_243_466_401, 1_042_686_046, 514_441_044, 774_655_284]),
    ("Операционные расходы", [454_526_798, 580_446_882, 647_437_089, 858_807_219, 405_813_983, 504_281_007]),
    ("Прибыль (убыток) до налогообложения", [-938_455_188, 228_874_837, 596_029_312, 183_878_827, 108_627_061, 270_374_277]),
    ("Прибыль (убыток) за отчетный период", [-756_771_839, 223_392_436, 559_057_757, 294_946_445, 164_711_086, 260_770_277]),
]

YEARS = [2026, 2027, 2028, 2029, 2030, 2031]  # год 0 - запуск и пилот

# Допущения (млн руб., если не указано иное)
SCENARIOS = {"Пониженный": [3_200, 16_000, 25_000], "Базовый": [6_400, 32_000, 50_000], "Повышенный": [9_600, 48_000, 75_000]}
A = dict(
    scenario=2, check_rub=300_000, fee=0.015, growth=0.20,
    subs=[2_000, 10_000, 20_000], sub_price=490, subs_growth=0.20,
    funds=[5, 20, 50], funds_growth=0.20,
    dispute_share=0.03, dispute_rub=300, var_rub=1_000,
    fixed=[30, 60, 150, 240], fixed_growth=0.05,
    capex=[250, 50, 30, 30, 30, 30], life=5, tax=0.25,
    terminal_growth=0.04,  # рост после 2031 года на уровне цели Банка России по инфляции
)


def vtb(name):
    return dict(VTB)[name]


def roe():
    """Рентабельность капитала 2023-2025: прибыль к среднему капиталу на начало и конец года."""
    eq, pr = vtb("Всего источников собственных средств"), vtb("Прибыль (убыток) за отчетный период")
    return [pr[i] / ((eq[i - 1] + eq[i]) / 2) for i in (1, 2, 3)]


def compute(a=A):
    rate = a.get("rate") or sum(roe()) / 3
    g = list(SCENARIOS.values())[a["scenario"] - 1]
    n = len(YEARS)
    gmv = [0.0] + g + [g[-1] * (1 + a["growth"]) ** k for k in (1, 2)]
    subs = [0.0] + a["subs"] + [a["subs"][-1] * (1 + a["subs_growth"]) ** k for k in (1, 2)]
    funds = [0.0] + a["funds"] + [a["funds"][-1] * (1 + a["funds_growth"]) ** k for k in (1, 2)]
    fixed = a["fixed"] + [a["fixed"][-1] * (1 + a["fixed_growth"]) ** k for k in (1, 2)]
    rows = {k: [] for k in ["gmv", "deals", "fee", "subs", "funds", "disp", "rev", "var", "fixed", "ebitda", "am", "ebt", "tax", "ni", "capex", "fcf", "cum", "df", "dcf", "dcum"]}
    cum = dcum = 0.0
    for y in range(n):
        deals = gmv[y] * 1e6 / a["check_rub"]
        fee = gmv[y] * a["fee"]
        sb = subs[y] * a["sub_price"] * 12 / 1e6
        disp = deals * a["dispute_share"] * a["dispute_rub"] / 1e6
        rev = fee + sb + funds[y] + disp
        var = deals * a["var_rub"] / 1e6
        ebitda = rev - var - fixed[y]
        am = sum(a["capex"][:y]) / a["life"]
        ebt = ebitda - am
        tax = ebt * a["tax"]
        ni = ebt - tax
        fcf = ni + am - a["capex"][y]
        cum += fcf
        df = 1 / (1 + rate) ** y
        dcum += fcf * df
        for k, v in zip(rows, [gmv[y], deals, fee, sb, funds[y], disp, rev, var, fixed[y], ebitda, am, ebt, tax, ni, a["capex"][y], fcf, cum, df, fcf * df, dcum]):
            rows[k].append(v)
    npv = rows["dcum"][-1]
    irr = _irr(rows["fcf"])
    tv = rows["fcf"][-1] * (1 + a["terminal_growth"]) / (rate - a["terminal_growth"])
    return rows, dict(rate=rate, npv=npv, tv=tv, dtv=tv * rows["df"][-1], npv_total=npv + tv * rows["df"][-1], irr=irr, payback=_payback(rows["cum"], rows["fcf"]), dpayback=_payback(rows["dcum"], rows["dcf"]))


def _payback(cum, flow):
    for y in range(1, len(cum)):
        if cum[y] >= 0 > cum[y - 1]:
            return (y - 1) + (-cum[y - 1]) / flow[y]
    return None


def _irr(flows):
    lo, hi = -0.99, 10.0
    f = lambda r: sum(c / (1 + r) ** i for i, c in enumerate(flows))
    for _ in range(200):
        mid = (lo + hi) / 2
        if f(mid) > 0:
            lo = mid
        else:
            hi = mid
    return mid


if __name__ == "__main__":
    rows, k = compute()
    for key in ("gmv", "rev", "ebitda", "ni", "fcf", "cum", "dcum"):
        print(key, [round(v, 1) for v in rows[key]])
    print({x: (round(v, 4) if v is not None else None) for x, v in k.items()}, [round(r, 4) for r in roe()])
