"use client";

import { useEffect } from "react";

export default function AppError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    if (/ChunkLoadError|Loading chunk/i.test(`${error.name} ${error.message}`)) {
      try {
        if (!sessionStorage.getItem("steppay.reloaded")) { sessionStorage.setItem("steppay.reloaded", "1"); location.reload(); }
      } catch { /* кнопка ниже */ }
    }
  }, [error]);
  return (
    <div className="page" style={{ textAlign: "center", paddingTop: 60 }}>
      <h2 className="title">Произошла ошибка</h2>
      <p className="sub" style={{ margin: "6px 0 16px" }}>Данные сохранены. Повторите открытие раздела.</p>
      <button className="btn" onClick={reset}>Обновить</button>
    </div>
  );
}
