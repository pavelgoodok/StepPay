import type { ContractTerms, Deal, JournalCheck, LedgerEntry, SignatureStatus } from "@steppay/engine";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export type Role = "customer" | "executor" | "sponsor" | "funder" | "arbiter" | "admin" | "user";
export interface PublicUser {
  id: string;
  name: string;
  role: Role;
  /** маскированный номер, только у зарегистрированных */
  phone?: string;
  avatar?: string;
  grantor?: boolean;
  /** кем зарегистрировался: заказчик или исполнитель */
  kind?: "customer" | "executor";
}
export interface Person {
  id: string;
  name: string;
  avatar?: string;
  /** рейтинг по отзывам, null пока отзывов нет */
  rating?: number | null;
  reviews?: number;
}
export interface ReviewItem { id: string; stars: number; text: string; at: number; dealTitle: string; from: Person }
export interface DealReviews {
  items: { id: string; stars: number; text: string; at: number; from: Person; to: Person }[];
  mine: { stars: number; text: string } | null;
  canReview: boolean;
  target: Person | null;
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
  meta?: Deal["meta"];
  signatures?: SignatureStatus | null;
  executorId: string;
  ownerId?: string;
  executor: Person;
  owner?: Person;
  target: number;
  raised: number;
  sponsors: number;
  stages: { done: number; total: number };
  reserved: number;
  paid: number;
  currentStage: { id: string; title: string; status: string } | null;
}
export interface WalletView extends Wallet {
  /** есть, если подключена тестовая сеть: баланс подкреплен токенами tRUB на адресе участника */
  chain?: { network: string; chainId: number; address: string; explorer?: string; onchain: number; matches: boolean };
  reserves: { dealId: string; title: string; amount: number; stages: { done: number; total: number } }[];
  history: LedgerEntry[];
}
export interface Template {
  id: string;
  title: string;
  icon: string;
  stages: { title: string; share: number; criteria: string[] }[];
}
export type DealFull = Deal & {
  summary: DealSummary;
  people: Record<string, Person>;
  contractCheck: { sealed: boolean; ok: boolean; expected?: string; actual: string };
  terms: ContractTerms;
  journalCheck: JournalCheck;
  signatureStatus: SignatureStatus & { valid: Record<string, boolean> };
  /** перенос действий сделки на контракт в тестовой сети: есть, только если сеть подключена */
  chainSync?: { state: "syncing" | "synced" | "failed"; error?: string; pending: number; txs: number };
};
/** Кошелек участника в тестовой сети: токены tRUB в копейках, эфир на газ в wei (строкой). */
export type ChainWallet = { enabled: false } | { enabled: true; network: string; chainId: number; contract: string; token: string; explorer?: string; address: string; eth: string; tokens: number };
export type ChainVerdict = { ok: boolean; applied: boolean; diffs: string[] };

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
    else {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem("steppay.me");
    }
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
  const raw = await res.text().catch(() => "");
  let data: unknown = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    // не JSON: прокси или перезапуск сервера отдали свою страницу; экраны ждут данные, а не мусор
    throw new ApiError(res.ok ? "Сервер отвечает не так, как ожидалось. Попробуйте еще раз" : "Ошибка", res.status || 502);
  }
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

/** Аватарка: обрезаем по центру до квадрата 256 px, сжимаем и загружаем; возвращает ссылку /uploads/... */
export async function uploadAvatar(file: File): Promise<string> {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) throw new ApiError("Не удалось прочитать фото", 0);
  const side = Math.min(bmp.width, bmp.height);
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  c.getContext("2d")!.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 256, 256);
  return (await api<{ url: string }>("/uploads", { method: "POST", body: { dataUrl: c.toDataURL("image/jpeg", 0.86) } })).url;
}

/** Закрытый документ открывается в новой вкладке по билету на 2 минуты, постоянный токен в ссылку не попадает. */
export async function openDoc(url: string): Promise<void> {
  const w = window.open("", "_blank");
  try {
    const { ticket } = await api<{ ticket: string }>("/auth/ticket", { method: "POST", body: {} });
    if (w) w.location.href = `${API_URL}${url}?ticket=${encodeURIComponent(ticket)}`;
  } catch (e) {
    w?.close();
    throw e;
  }
}

/** PDF до 5 МБ, доступен только автору и администраторам. */
export async function uploadDoc(file: File): Promise<string> {
  if (file.type !== "application/pdf") throw new ApiError("Документ должен быть в формате PDF", 0);
  if (file.size > 5 * 1024 * 1024) throw new ApiError("Файл больше 5 МБ", 0);
  const dataUrl = await new Promise<string>((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => no(new ApiError("Не удалось прочитать файл", 0));
    r.readAsDataURL(file);
  });
  return (await api<{ url: string }>("/uploads", { method: "POST", body: { dataUrl, private: true } })).url;
}

export type ProjectKind = "crowdfunding" | "grant";
export type ProjectStatus = "draft" | "review" | "changes" | "approved" | "rejected";
export interface ProjectDoc { id: string; name: string; url: string; kind: "photo" | "doc" }
export interface ProjectStage { title: string; amount: number; criteria: string[] }
export interface ReviewEvent { at: number; by: string; action: "submit" | "resubmit" | "approve" | "reject" | "changes"; comment?: string }
export interface FnsCheck { status: "match" | "mismatch" | "unavailable" | "none"; checkedAt: number; source: string; name?: string; detail: string }
export interface AuthorProfile { legalStatus: "person" | "selfemployed" | "ip" | "org"; inn: string; orgName?: string; email?: string; fns?: FnsCheck }
export interface ProjectItem {
  id: string;
  kind: ProjectKind;
  title: string;
  summary: string;
  category: string;
  cover?: string;
  goal: number;
  stageCount: number;
  raised: number;
  sponsors: number;
  dealId?: string;
  dealStatus?: string;
  owner: Person;
  status?: ProjectStatus;
  lastReview?: ReviewEvent;
  submittedAt?: number;
}
export interface ProjectFull extends ProjectItem {
  description: string;
  stages: ProjectStage[];
  photos: ProjectDoc[];
  status: ProjectStatus;
  docs?: ProjectDoc[];
  history?: ReviewEvent[];
  author?: AuthorProfile | null;
  deal: DealSummary | null;
  funder?: Person;
  can: { edit: boolean; fundGrant: boolean; support: boolean };
  problems?: string[];
}
export interface ServiceItem { id: string; title: string; category: string; description: string; priceFrom?: number; photos: string[]; active: boolean; owner: Person; mine?: boolean; chatId?: string }
export interface ChatItem {
  id: string;
  role: "customer" | "executor";
  service: { id: string; title: string };
  with: Person;
  last: { text: string; at: number; by: string; kind: "text" | "system" } | null;
  unread: number;
  updatedAt: number;
}
export interface ChatMessage { id: string; by: string; text: string; at: number; kind: "text" | "system"; dealId?: string }
export interface ChatFull {
  id: string;
  role: "customer" | "executor";
  service: { id: string; title: string };
  with: Person;
  messages: ChatMessage[];
  deals: (DealSummary & { description?: string; agreed?: number })[];
  me: Person;
}
export interface PlanResult {
  title: string;
  source: "claude" | "template";
  reason?: { code: string; text: string };
  stages: { title: string; share: number; criteria: string[] }[];
}

/** Загружает уже подготовленную картинку (после обрезки); возвращает ссылку вида /uploads/... */
export async function uploadDataUrl(dataUrl: string): Promise<string> {
  return (await api<{ url: string }>("/uploads", { method: "POST", body: { dataUrl } })).url;
}
