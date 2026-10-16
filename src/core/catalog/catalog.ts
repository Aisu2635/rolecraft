import type { ServiceIndex, ServiceIndexEntry, SlimService } from "../types";

export interface Catalog {
  getService(key: string): SlimService | undefined;
  hasService(key: string): boolean;
}

export function createCatalog(services: SlimService[]): Catalog {
  const map = new Map(services.map((s) => [s.key, s]));
  return {
    getService: (key) => map.get(key),
    hasService: (key) => map.has(key),
  };
}

function rank(entry: ServiceIndexEntry, q: string): number {
  const key = entry.key.toLowerCase();
  const name = entry.name.toLowerCase();
  if (key === q) return 0;
  if (key.startsWith(q)) return 1;
  if (name.split(/[^a-z0-9]+/).some((w) => w.startsWith(q))) return 2;
  if (key.includes(q) || name.includes(q)) return 3;
  return -1;
}

export function searchServices(
  index: ServiceIndex,
  query: string,
  limit = 20,
): ServiceIndexEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return index.services
    .map((entry) => ({ entry, r: rank(entry, q) }))
    .filter((x) => x.r >= 0)
    .sort(
      (a, b) =>
        a.r - b.r ||
        (a.entry.key < b.entry.key ? -1 : 1),
    )
    .slice(0, limit)
    .map((x) => x.entry);
}
