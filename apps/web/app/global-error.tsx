"use client";
import { useEffect } from "react";

/** Устаревшие файлы после обновления сайта: один раз перезагружаем страницу, остальное показываем с кнопкой. */
export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    const stale = /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported|Importing a module script failed/i.test(`${error.name} ${error.message}`);
    try {
      if (stale && !sessionStorage.getItem("steppay.reloaded")) {
        sessionStorage.setItem("steppay.reloaded", "1");
        location.reload();
      }
    } catch {
      /* без sessionStorage просто покажем кнопку */
    }
  }, [error]);
  return (
    <html lang="ru">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#f1f3f8", margin: 0, display: "grid", placeItems: "center", minHeight: "100vh", textAlign: "center", padding: 16 }}>
        <div>
          <h2 style={{ margin: "0 0 6px" }}>Произошла ошибка</h2>
          <p style={{ margin: "0 0 16px", color: "#556" }}>Данные сохранены. Обновите страницу.</p>
          <button onClick={() => { reset(); location.reload(); }} style={{ background: "#0a3aa6", color: "#fff", border: 0, borderRadius: 14, padding: "12px 22px", fontSize: 16 }}>Обновить</button>
        </div>
      </body>
    </html>
  );
}
