"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type ServiceItem } from "@/lib/api";
import { toKopecks } from "@/lib/format";
import { useSession } from "@/lib/session";
import { Icon, MoneyInput } from "./ui";
import { PhotoPicker } from "./photos";

const CATS = ["Ремонт и строительство", "Разработка и дизайн", "Мероприятия", "Обучение", "Красота и здоровье", "Другое"];

export function ServiceForm({ id }: { id?: string }) {
  const router = useRouter();
  const { toast } = useSession();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(CATS[0]!);
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    api<ServiceItem>(`/services/${id}`).then((s) => {
      setTitle(s.title);
      setCategory(s.category);
      setDescription(s.description);
      setPrice(s.priceFrom ? String(Math.round(s.priceFrom / 100)) : "");
      setPhotos(s.photos);
    }).catch((e: Error) => toast(e.message, "err"));
  }, [id, toast]);

  async function save() {
    setBusy(true);
    try {
      const body = { title: title.trim(), category, description: description.trim(), photos, priceFrom: Number(price) > 0 ? toKopecks(Number(price)) : undefined };
      const s = await api<ServiceItem>(id ? `/services/${id}/update` : "/services", { method: "POST", body });
      toast(id ? "Сохранено" : "Услуга опубликована");
      router.replace(`/services/${s.id}`);
    } catch (e) {
      toast((e as Error).message, "err");
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <Link href={id ? `/services/${id}` : "/catalog"} className="btn ghost sm" style={{ paddingLeft: 0, alignSelf: "flex-start" }}><Icon name="back" size={18} /> Назад</Link>
      <h1 className="h1">{id ? "Редактирование услуги" : "Новая услуга"}</h1>
      <div className="card stack">
        <div className="field">
          <label>Название</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название услуги" />
        </div>
        <div className="field">
          <label>Категория</label>
          <div className="chips">
            {CATS.map((c) => <button key={c} className={`opt ${category === c ? "on" : ""}`} onClick={() => setCategory(c)}>{c}</button>)}
          </div>
        </div>
        <div className="field">
          <label>Что вы делаете</label>
          <textarea className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Опишите, чем вы занимаетесь" style={{ minHeight: 120 }} />
        </div>
        <div className="field">
          <label>Цена от, ₽ (необязательно)</label>
          <MoneyInput value={price} onChange={setPrice} placeholder="Сумма, ₽" />
        </div>
        <div className="field">
          <label>Фото работ</label>
          <PhotoPicker value={photos} onChange={setPhotos} max={6} />
        </div>
      </div>
      <button className="btn" disabled={busy || title.trim().length < 3 || description.trim().length < 20} onClick={save}>{busy ? "Сохраняем…" : id ? "Сохранить" : "Опубликовать"}</button>
    </div>
  );
}
