#!/usr/bin/env python3
"""Режет лист с несколькими 3D-объектами на отдельные файлы webp с прозрачным фоном.
Использование: python3 slice-3d.py лист.png public/3d имя1 имя2 имя3 имя4
Если объекты стоят вплотную и склеиваются, задайте GRID=<строка разреза> (сетка 2x2) или меньший DIL (число расширений маски).
Объекты нумеруются по рядам: сверху вниз, слева направо. Фон: прозрачный или почти белый."""
import sys
import numpy as np
from PIL import Image

src, out, *names = sys.argv[1:]
im = Image.open(src).convert("RGBA")
a = np.array(im)
alpha = a[..., 3] > 16
white = (a[..., :3] > 244).all(axis=-1)
obj = alpha & ~white if alpha.mean() < 0.98 else ~white
K = 4  # работаем на уменьшенной маске
m = obj[::K, ::K]
# склеиваем части одного объекта (монета, тень, пунктир): расширяем маску
d = m.copy()
for _ in range(int(__import__("os").environ.get("DIL", "3"))):
    p = np.pad(d, 1)
    d = d | p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:]
lab = np.zeros(d.shape, int)
n = 0
for y, x in zip(*np.nonzero(d)):
    if lab[y, x]:
        continue
    n += 1
    st = [(y, x)]
    lab[y, x] = n
    while st:
        cy, cx = st.pop()
        for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
            if 0 <= ny < d.shape[0] and 0 <= nx < d.shape[1] and d[ny, nx] and not lab[ny, nx]:
                lab[ny, nx] = n
                st.append((ny, nx))
boxes = []
if __import__("os").environ.get("GRID"):
    # сетка 2x2: когда объекты стоят в четвертях листа, делим по осям и обрезаем по содержимому
    # GRID=<строка разреза по вертикали в пикселях листа>, по горизонтали режем пополам
    H, W = obj.shape
    cut = int(__import__("os").environ["GRID"])
    for y0, y1 in ((0, cut), (cut, H)):
        for x0, x1 in ((0, W // 2), (W // 2, W)):
            ys, xs = np.nonzero(obj[y0:y1, x0:x1])
            boxes.append((y0 + ys.min(), y0 + ys.max() + 1, x0 + xs.min(), x0 + xs.max() + 1, 0))
    n = 0
for i in range(1, n + 1):
    ys, xs = np.nonzero((lab == i) & m)
    if len(ys) < 200:
        continue
    boxes.append((ys.min() * K, ys.max() * K + K, xs.min() * K, xs.max() * K + K, i))
if len(boxes) != len(names):
    sys.exit(f"найдено объектов {len(boxes)}, имен {len(names)}")
mid = np.median([(b[0] + b[1]) / 2 for b in boxes])
boxes.sort(key=lambda b: (0 if (b[0] + b[1]) / 2 < mid else 1, b[2]))
for name, (y0, y1, x0, x1, li) in zip(names, boxes):
    pad = 2
    cx0, cy0, cx1, cy1 = max(0, x0 - pad), max(0, y0 - pad), min(im.width, x1 + pad), min(im.height, y1 + pad)
    crop = im.crop((cx0, cy0, cx1, cy1))
    c = np.array(crop)
    if li:  # остатки соседних объектов в рамке стираем: оставляем только пиксели этого объекта
        own = np.kron(lab == li, np.ones((K, K), bool))[:obj.shape[0], :obj.shape[1]]
        own = np.pad(own, ((0, obj.shape[0] - own.shape[0]), (0, obj.shape[1] - own.shape[1])))[cy0:cy1, cx0:cx1]
        c[..., 3] = np.where(own, c[..., 3], 0)
        crop = Image.fromarray(c)
    if alpha.mean() >= 0.98:  # фон белый: убираем его в прозрачность
        w = (c[..., :3] > 244).all(axis=-1)
        c[..., 3] = np.where(w, 0, 255)
        crop = Image.fromarray(c)
    crop.thumbnail((640, 640))
    crop.save(f"{out}/{name}.webp", quality=90)
    print(name, crop.size)
