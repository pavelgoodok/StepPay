"use client";

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="page" style={{ textAlign: "center", paddingTop: 60 }}>
      <h2 className="title">Что-то пошло не так</h2>
      <p className="sub" style={{ margin: "6px 0 16px" }}>Данные не потеряны. Попробуйте открыть экран еще раз.</p>
      <button className="btn" onClick={reset}>Обновить</button>
    </div>
  );
}
