"use client";
import { useState } from "react";
import { AuthorForm } from "@/components/author-form";
import { api, type AuthorProfile } from "@/lib/api";
import { dateTime } from "@/lib/admin";
import { usePoll } from "@/lib/session";

interface Status {
  status: "none" | "pending" | "approved" | "rejected";
  at?: number;
  decidedAt?: number;
  comment?: string;
}

/** Подтверждение данных профессионального аккаунта: заявка администратору, после одобрения в профиле появляется отметка «Проверено». */
export function VerificationCard() {
  const { data, reload } = usePoll(() => api<Status>("/me/verification"), []);
  const author = usePoll(() => api<AuthorProfile | null>("/me/author"), []);
  const [form, setForm] = useState(false);
  if (!data) return null;

  return (
    <div className="card stack">
      <div className="row between">
        <div className="title">Подтверждение данных</div>
        {data.status === "approved" && <span className="chip green">Проверено</span>}
        {data.status === "pending" && <span className="chip amber">На рассмотрении</span>}
        {data.status === "rejected" && <span className="chip red">Отказано</span>}
      </div>
      {data.status === "none" && <p className="sub">Подтвердите данные организации или предпринимателя: рядом с именем в каталоге и профиле появится отметка «Проверено». Заказчики охотнее выбирают проверенных исполнителей.</p>}
      {data.status === "pending" && <p className="sub">Заявка отправлена {data.at ? dateTime(data.at) : ""}. Администратор сверит данные с реестрами ФНС, решение придет в уведомлениях.</p>}
      {data.status === "approved" && <p className="sub">Данные подтверждены{data.decidedAt ? ` ${dateTime(data.decidedAt)}` : ""}. Отметка отображается в вашем профиле и в каталоге.</p>}
      {data.status === "rejected" && <p className="sub">{data.comment ? `Причина отказа: ${data.comment}. ` : ""}Исправьте данные и отправьте заявку повторно.</p>}
      {(data.status === "none" || data.status === "rejected") && !form && (
        <button className="btn soft" onClick={() => setForm(true)}>{data.status === "none" ? "Подать заявку" : "Подать повторно"}</button>
      )}
      {form && (
        <AuthorForm
          verify
          initial={author.data}
          onSaved={() => {
            setForm(false);
            void reload();
          }}
        />
      )}
    </div>
  );
}
