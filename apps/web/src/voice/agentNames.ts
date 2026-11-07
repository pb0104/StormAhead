/** Map spoken names → forecast agent ids used by the factor picker. */
export type AgentCatalog = { id: string; name: string; factor: string };

export function resolveAgentIds(
  names: string[],
  catalog: AgentCatalog[],
): { ids: string[]; unknown: string[] } {
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const raw of names) {
    const q = raw.trim().toLowerCase();
    if (!q) continue;
    const hit = catalog.find((a) => {
      const id = a.id.toLowerCase();
      const factor = a.factor.toLowerCase();
      const name = a.name.toLowerCase();
      return id === q
        || factor === q
        || name === q
        || factor.includes(q)
        || name.includes(q)
        || id.includes(q)
        || q.includes(id);
    });
    if (hit) ids.push(hit.id);
    else unknown.push(raw);
  }
  return { ids: [...new Set(ids)], unknown };
}
