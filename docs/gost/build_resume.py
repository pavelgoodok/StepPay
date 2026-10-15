# Сборка документа «Резюме проекта StepPay» по ЕСПД из docs/cbr/StepPay_resume.md.
import pathlib, re, sys
from gostdoc import Doc, build

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / "docs/cbr/StepPay_resume.md"
ORG = "Проект StepPay"
SYS = "Платформа StepPay. Оплата по шагам в цифровых рублях"
KIND = "Резюме проекта"
AUTHOR = "Гудков Павел Алексеевич\npavlusha220@yandex.ru\n+7 995 540-71-20"
DESIG = "STEPPAY.00003-01 90 01"


def sections():
    """Разбирает markdown: заголовки второго уровня становятся разделами, списки и абзацы остаются как есть."""
    text = SRC.read_text()
    text = re.sub(r"^---.*?---\n", "", text, count=1, flags=re.S)
    out, cur = [], None
    for line in text.split("\n"):
        if line.startswith("## "):
            cur = {"title": line[3:].strip(), "items": []}
            out.append(cur)
        elif cur is not None and line.strip():
            cur["items"].append(line.rstrip())
    return out


def make(pages):
    secs = sections()
    D = Doc()
    D.total = pages.get("__total__", "[N]")
    D.approval_and_title(ORG, SYS, KIND, DESIG, "Автор проекта", "2026", "", AUTHOR)
    D.toc([(1, f"{i} {s['title'].upper()}") for i, s in enumerate(secs, 1)], pages)
    for i, s in enumerate(secs, 1):
        D.h1(str(i), s["title"], newpage=False)
        for it in s["items"]:
            m = re.match(r"^(\d+)\. (.*)", it)
            if it.startswith("- "):
                D.bullet(it[2:])
            elif m:
                D.p(f"{m.group(1)}) {m.group(2)}")
            else:
                D.p(it)
    return D


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "StepPay_Resume_GOST"
    docx, pdf, n = build(make, out)
    print(docx, pdf, "страниц:", n)
