"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { photoSrc, uploadPhoto } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Icon } from "./ui";

/** Выбор до `max` фото: с камеры или из галереи. Возвращает ссылки через onChange. */
export function PhotoPicker({ value, onChange, max = 6 }: { value: string[]; onChange(v: string[]): void; max?: number }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useSession();

  async function add(files: FileList | null) {
    if (!files) return;
    setBusy(true);
    try {
      const urls: string[] = [];
      for (const f of Array.from(files).slice(0, max - value.length)) urls.push(await uploadPhoto(f));
      onChange([...value, ...urls]);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="photos">
      {value.map((u) => (
        <div key={u} className="ph">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photoSrc(u)} alt="" />
          <button aria-label="Убрать фото" onClick={() => onChange(value.filter((x) => x !== u))}><Icon name="x" size={14} /></button>
        </div>
      ))}
      {value.length < max && (
        <button className="ph add" disabled={busy} onClick={() => input.current?.click()}>
          <Icon name="camera" size={24} />
          <span>{busy ? "Загрузка…" : "Фото"}</span>
        </button>
      )}
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => void add(e.target.files)} />
    </div>
  );
}

export function PhotoGrid({ photos }: { photos?: string[] }) {
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", k);
      document.body.style.overflow = prev;
    };
  }, [open]);
  if (!photos?.length) return null;
  return (
    <>
      <div className="photos">
        {photos.map((u) => (
          <button key={u} className="ph" onClick={() => setOpen(u)} aria-label="Открыть фото">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoSrc(u)} alt="" />
          </button>
        ))}
      </div>
      {open &&
        createPortal(
          <div className="lightbox" onClick={() => setOpen(null)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoSrc(open)} alt="" />
            <button className="lb-x" aria-label="Закрыть" onClick={() => setOpen(null)}><Icon name="x" size={20} /></button>
          </div>,
          document.body,
        )}
    </>
  );
}
