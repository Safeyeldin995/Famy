/**
 * Collects provider ids asked for in the same tick and fetches their trust stats in one
 * call, so a list of cards makes one request instead of one per card. Framework-free;
 * each client wires it to its own Supabase client.
 */
import { normalizeTrustStats, type ProviderTrustStats } from "./trustBadges";

export type FetchTrustRows = (ids: string[]) => Promise<Record<string, unknown>[]>;

export function createTrustStatsLoader(fetchRows: FetchTrustRows, maxBatch = 100) {
  let queue: {
    id: string;
    resolve: (v: ProviderTrustStats | null) => void;
    reject: (e: unknown) => void;
  }[] = [];
  let scheduled = false;

  const flush = async () => {
    scheduled = false;
    const batch = queue;
    queue = [];
    for (let i = 0; i < batch.length; i += maxBatch) {
      const chunk = batch.slice(i, i + maxBatch);
      const ids = [...new Set(chunk.map((item) => item.id))];
      try {
        const rows = await fetchRows(ids);
        const byId = new Map<string, ProviderTrustStats>();
        for (const row of rows) {
          const stats = normalizeTrustStats(row);
          if (stats) byId.set(stats.provider_id, stats);
        }
        for (const item of chunk) item.resolve(byId.get(item.id) ?? null);
      } catch (error) {
        for (const item of chunk) item.reject(error);
      }
    }
  };

  return {
    load(id: string): Promise<ProviderTrustStats | null> {
      return new Promise((resolve, reject) => {
        queue.push({ id, resolve, reject });
        if (!scheduled) {
          scheduled = true;
          setTimeout(() => void flush(), 0);
        }
      });
    },
  };
}
