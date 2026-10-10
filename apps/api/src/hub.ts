import type { ServerResponse } from "node:http";

/** Рассылка событий в открытые SSE-соединения по пользователям. */
export class Hub {
  private clients = new Map<string, Set<ServerResponse>>();

  add(userId: string, res: ServerResponse) {
    if (!this.clients.has(userId)) this.clients.set(userId, new Set());
    this.clients.get(userId)!.add(res);
    res.on("close", () => this.clients.get(userId)?.delete(res));
  }

  send(userIds: Iterable<string>, event: string, data: unknown) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const id of new Set(userIds)) for (const res of this.clients.get(id) ?? []) res.write(payload);
  }

  heartbeat() {
    for (const set of this.clients.values()) for (const res of set) res.write(": ping\n\n");
  }

  closeAll() {
    for (const set of this.clients.values()) for (const res of set) res.end();
    this.clients.clear();
  }
}
