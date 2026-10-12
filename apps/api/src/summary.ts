import { signatureStatus, type Deal } from "@steppay/engine";

export function stageCounts(d: Deal) {
  const done = d.stages.filter((x) => x.status === "accepted").length;
  return { done, total: d.stages.length };
}

export function summary(d: Deal) {
  const raised = Object.values(d.contributed).reduce((a, b) => a + b, 0);
  const current = d.stages.find((x) => ["active", "submitted", "disputed"].includes(x.status));
  return {
    id: d.id,
    mode: d.mode,
    title: d.title,
    status: d.status,
    executorId: d.executorId,
    ownerId: d.ownerId,
    meta: d.meta,
    signatures: d.signing && d.contract ? signatureStatus(d) : null,
    target: d.target,
    raised,
    sponsors: Object.keys(d.contributed).length,
    stages: stageCounts(d),
    currentStage: current ? { id: current.id, title: current.title, status: current.status } : null,
  };
}
