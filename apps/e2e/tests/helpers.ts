import type { APIRequestContext, Page } from "@playwright/test";

export const API = "http://localhost:4000";

/** Токен демо-пользователя: как после входа через экран демо-аккаунтов. */
export async function tokenOf(request: APIRequestContext, userId: string): Promise<string> {
  const r = await request.post(`${API}/auth/demo`, { data: { userId } });
  return (await r.json()).token as string;
}

/** Вход под демо-пользователем: токен кладется туда же, куда его кладет приложение. */
export async function loginAs(page: Page, request: APIRequestContext, userId: string): Promise<string> {
  const token = await tokenOf(request, userId);
  await page.addInitScript((t) => {
    localStorage.setItem("steppay.token", t);
    localStorage.setItem("steppay.theme", "light");
  }, token);
  return token;
}

export async function callApi<T = unknown>(request: APIRequestContext, token: string, method: "GET" | "POST", url: string, data?: unknown): Promise<T> {
  const r = await request.fetch(`${API}${url}`, { method, data, headers: { authorization: `Bearer ${token}` } });
  return (await r.json()) as T;
}

/** Чистое демо-состояние и первые шаги сценария: чат, задача, этапы и отправка условий (шаг 3). */
export async function resetDemo(request: APIRequestContext, steps = 0): Promise<void> {
  // ключи подписи демо-аккаунтов переживают сброс сделок: отзываем, чтобы сценарии не зависели друг от друга
  for (const user of ["anna", "ivan", "olga", "max"]) {
    const token = await tokenOf(request, user);
    const keys = await callApi<{ id: string; active: boolean }[]>(request, token, "GET", "/me/keys");
    for (const k of keys.filter((x) => x.active)) await callApi(request, token, "POST", `/me/keys/${k.id}/revoke`, {});
  }
  await request.post(`${API}/demo/reset`, { data: {} });
  for (let i = 1; i <= steps; i++) await request.post(`${API}/demo/step`, { data: { step: i } });
}
