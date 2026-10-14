"use client";
import { useSession } from "@/lib/session";

/** Адрес или хеш: показывается целиком в моноширинном виде, по нажатию копируется. */
export function CopyText({ value, href, label }: { value: string; href?: string; label?: string }) {
  const { toast } = useSession();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast("Скопировано");
    } catch {
      toast("Не удалось скопировать, выделите текст вручную", "err");
    }
  };
  return (
    <div className="stack" style={{ gap: 4 }}>
      {label && <div className="small muted">{label}</div>}
      <button className="mono small" style={{ textAlign: "left", wordBreak: "break-all", padding: 0 }} onClick={() => void copy()} aria-label={`Скопировать ${label ?? "значение"}`}>{value}</button>
      <div className="row" style={{ gap: 14 }}>
        <button className="btn ghost sm" style={{ paddingLeft: 0 }} onClick={() => void copy()}>Скопировать</button>
        {href && <a className="btn ghost sm" href={href} target="_blank" rel="noreferrer">Открыть в обозревателе</a>}
      </div>
    </div>
  );
}
