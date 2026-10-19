import type { ServerResponse } from "node:http";

/** Рассылка событий в открытые SSE-соединения по пользователям. */
export class Hub {
  private clients = new Map<string, Set<ServerResponse>>();

  add(userId: string, res: ServerResponse) {
    if (!this.clients.has(userId)) this.clients.set(userId, new Set());
    this.clients.get(userId)!.add(res);
    res.on("close", () => this.clients.get(userId)?.delete(res));
  }

  /** Куда складывать уведомления, чтобы их можно было прочитать позже в отдельном разделе. */
  sink?: (userIds: string[], data: { dealId: string; text: string }) => void;

  /** Передача события другим экземплярам API, чтобы оно дошло до их открытых соединений. */
  relay?: (userIds: string[], event: string, data: unknown) => void;

  send(userIds: Iterable<string>, event: string, data: unknown) {
    const ids = [...new Set(userIds)];
    if (event === "notify" && this.sink) this.sink(ids, data as { dealId: string; text: string });
    this.relay?.(ids, event, data);
    this.deliver(ids, event, data);
  }

  /** Доставка только в соединения этого экземпляра (так же приходят события от других экземпляров). */
  deliver(userIds: Iterable<string>, event: string, data: unknown) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const id of new Set(userIds)) for (const res of this.clients.get(id) ?? []) {
      try {
        res.write(payload);
      } catch {
        this.clients.get(id)?.delete(res);
      }
    }
  }

  heartbeat() {
    for (const set of this.clients.values()) for (const res of [...set]) {
      try {
        res.write(": ping\n\n");
      } catch {
        set.delete(res);
      }
    }
  }

  closeAll() {
    for (const set of this.clients.values()) for (const res of set) res.end();
    this.clients.clear();
  }
}
