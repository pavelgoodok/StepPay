import type { Deal, LedgerEntry } from "@steppay/engine";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export type Role = "customer" | "executor" | "sponsor" | "funder" | "arbiter" | "user";
export interface PublicUser {
  id: string;
  name: string;
  role: Role;
  /** маскированный номер, только у зарегистрированных */
  phone?: string;
}
export interface FoundUser {
  id: string;
  name: string;
  phone?: string;
}
export interface Wallet {
  free: number;
  reserved: number;
}
export interface DealSummary {
  id: string;
  mode: Deal["mode"];
  title: string;
  status: Deal["status"];
  executorId: string;
  ownerId?: string;
  target: number;
  raised: number;
  sponsors: number;
  stages: { done: number; total: number };
  currentStage: { id: string; title: string; status: string } | null;
}
export interface WalletView extends Wallet {
  reserves: { dealId: string; title: string; amount: number; stages: { done: number; total: number } }[];
  history: LedgerEntry[];
}
export interface Template {
  id: string;
  title: string;
  icon: string;
  stages: { title: string; share: number; criteria: string[] }[];
}
export type DealFull = Deal & { summary: DealSummary };

const TOKEN_KEY = "steppay.token";
export const getToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};
export const setToken = (t: string | null) => {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* приватный режим - работаем без сохранения */
  }
};

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method: init.method ?? "GET",
      headers: {
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError("Нет связи с сервером", 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? "Ошибка", res.status);
  return data as T;
}

export const photoSrc = (url: string) => (url.startsWith("/") ? API_URL + url : url);

/** Уменьшает фото на устройстве (до 1280px, JPEG) и загружает; возвращает ссылку вида /uploads/… */
export async function uploadPhoto(file: File): Promise<string> {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) throw new ApiError("Не удалось прочитать фото", 0);
  const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  let q = 0.82;
  let dataUrl = c.toDataURL("image/jpeg", q);
  while (dataUrl.length > 1_100_000 && q > 0.4) {
    q -= 0.12;
    dataUrl = c.toDataURL("image/jpeg", q);
  }
  return (await api<{ url: string }>("/uploads", { method: "POST", body: { dataUrl } })).url;
}
