"use client";
import { useEffect, useRef, useState } from "react";
import { Sheet } from "./ui";

interface Props {
  file: File;
  /** соотношение сторон рамки: 1 для аватарки, 16 / 9 для обложки */
  aspect: number;
  /** круглая маска (аватарка) или прямоугольная (обложка) */
  round?: boolean;
  /** ширина итоговой картинки в пикселях */
  outWidth: number;
  title: string;
  onDone(dataUrl: string): void;
  onClose(): void;
}

/** Обрезка как в Телеграме: двигайте фото пальцем или мышью, масштабируйте щипком, колесом или ползунком. */
export function CropSheet({ file, aspect, round, outWidth, title, onDone, onClose }: Props) {
  const box = Math.min(320, typeof window === "undefined" ? 320 : window.innerWidth - 64);
  const vw = box;
  const vh = Math.round(box / aspect);
  const canvas = useRef<HTMLCanvasElement>(null);
  const img = useRef<ImageBitmap | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(1); // 1 = фото ровно покрывает рамку
  const view = useRef({ zoom: 1, x: 0, y: 0 }); // x, y: смещение центра фото от центра рамки в пикселях рамки
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);

  const base = () => (img.current ? Math.max(vw / img.current.width, vh / img.current.height) : 1);

  function clamp() {
    const im = img.current;
    if (!im) return;
    const v = view.current;
    v.zoom = Math.min(6, Math.max(1, v.zoom));
    const s = base() * v.zoom;
    const maxX = Math.max(0, (im.width * s - vw) / 2);
    const maxY = Math.max(0, (im.height * s - vh) / 2);
    v.x = Math.min(maxX, Math.max(-maxX, v.x));
    v.y = Math.min(maxY, Math.max(-maxY, v.y));
  }

  function draw() {
    const c = canvas.current;
    const im = img.current;
    if (!c || !im) return;
    clamp();
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    c.width = vw * ratio;
    c.height = vh * ratio;
    const ctx = c.getContext("2d")!;
    const s = base() * view.current.zoom * ratio;
    ctx.fillStyle = "#e9edf5";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(im, c.width / 2 + view.current.x * ratio - (im.width * s) / 2, c.height / 2 + view.current.y * ratio - (im.height * s) / 2, im.width * s, im.height * s);
    setZoom(view.current.zoom);
  }

  useEffect(() => {
    let alive = true;
    createImageBitmap(file, { imageOrientation: "from-image" })
      .catch(() => createImageBitmap(file))
      .then((b) => {
        if (!alive) return;
        img.current = b;
        setReady(true);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [file]);
  useEffect(() => {
    if (ready) draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  function down(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), zoom: view.current.zoom };
    }
  }
  function move(e: React.PointerEvent) {
    const p = pointers.current.get(e.pointerId);
    if (!p) return;
    if (pointers.current.size === 2 && pinch.current) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [a, b] = [...pointers.current.values()];
      view.current.zoom = pinch.current.zoom * (Math.hypot(a!.x - b!.x, a!.y - b!.y) / pinch.current.dist);
    } else {
      view.current.x += e.clientX - p.x;
      view.current.y += e.clientY - p.y;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    draw();
  }
  function up(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    pinch.current = null;
  }
  function wheel(e: React.WheelEvent) {
    view.current.zoom *= e.deltaY < 0 ? 1.08 : 1 / 1.08;
    draw();
  }

  function done() {
    const im = img.current;
    if (!im) return;
    clamp();
    const outH = Math.round(outWidth / aspect);
    const out = document.createElement("canvas");
    out.width = outWidth;
    out.height = outH;
    const k = outWidth / vw;
    const s = base() * view.current.zoom * k;
    const ctx = out.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, outWidth, outH);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(im, outWidth / 2 + view.current.x * k - (im.width * s) / 2, outH / 2 + view.current.y * k - (im.height * s) / 2, im.width * s, im.height * s);
    let q = 0.88;
    let url = out.toDataURL("image/jpeg", q);
    while (url.length > 1_100_000 && q > 0.45) {
      q -= 0.1;
      url = out.toDataURL("image/jpeg", q);
    }
    onDone(url);
  }

  return (
    <Sheet onClose={onClose}>
      <h2 style={{ fontSize: 22, textAlign: "left" }}>{title}</h2>
      <div className="stack" style={{ marginTop: 14, alignItems: "center" }}>
        {failed ? (
          <div className="note bad">Не удалось открыть фото. Выберите другое.</div>
        ) : (
          <>
            <div className="crop" style={{ width: vw, height: vh }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel}>
              <canvas ref={canvas} style={{ width: vw, height: vh }} />
              <div className={`crop-mask ${round ? "round" : ""}`} />
            </div>
            <input className="zoom" type="range" min={1} max={6} step={0.01} value={zoom} aria-label="Масштаб" onChange={(e) => { view.current.zoom = Number(e.target.value); draw(); }} />
            <div className="small muted" style={{ textAlign: "center" }}>Двигайте фото и меняйте масштаб</div>
          </>
        )}
        <div className="btns" style={{ width: "100%" }}>
          <button className="btn soft" onClick={onClose}>Отмена</button>
          <button className="btn" disabled={!ready} onClick={done}>Готово</button>
        </div>
      </div>
    </Sheet>
  );
}
