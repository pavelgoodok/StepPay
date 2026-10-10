export type Role = "customer" | "executor" | "sponsor" | "funder" | "arbiter";

export interface User {
  id: string;
  name: string;
  role: Role;
  /** стартовый баланс демо-кошелька, ₽ */
  startBalance: number;
}

/** Демо-пользователи: вход в один клик, без паролей. */
export const DEMO_USERS: User[] = [
  { id: "anna", name: "Анна Смирнова", role: "customer", startBalance: 300_000 },
  { id: "ivan", name: "Иван Петров", role: "executor", startBalance: 0 },
  { id: "olga", name: "Ольга Н.", role: "sponsor", startBalance: 150_000 },
  { id: "max", name: "Максим К.", role: "sponsor", startBalance: 150_000 },
  { id: "fond", name: "Фонд «Развитие»", role: "funder", startBalance: 2_000_000 },
  { id: "expert", name: "Независимый приёмщик", role: "arbiter", startBalance: 0 },
];

export const userById = (id: string) => DEMO_USERS.find((u) => u.id === id);
