import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AreaRequestRow = { user_id: string; lat: number; lng: number; created_at: string };

export type AreaRequestCluster = {
  key: string;
  lat: number;
  lng: number;
  requests: number;
  customers: number;
  latestAt: string;
};

/** Group requests into ~1 km cells (2 decimal places) and sort by demand. */
export function clusterAreaRequests(rows: AreaRequestRow[]): AreaRequestCluster[] {
  const cells = new Map<string, { rows: AreaRequestRow[] }>();
  for (const row of rows) {
    const key = `${row.lat.toFixed(2)},${row.lng.toFixed(2)}`;
    const cell = cells.get(key) ?? { rows: [] };
    cell.rows.push(row);
    cells.set(key, cell);
  }
  return [...cells.entries()]
    .map(([key, { rows: list }]) => ({
      key,
      lat: list.reduce((s, r) => s + r.lat, 0) / list.length,
      lng: list.reduce((s, r) => s + r.lng, 0) / list.length,
      requests: list.length,
      customers: new Set(list.map((r) => r.user_id)).size,
      latestAt: list
        .map((r) => r.created_at)
        .sort()
        .at(-1)!,
    }))
    .sort((a, b) => b.customers - a.customers || b.requests - a.requests);
}

export function useAdminAreaRequests() {
  return useQuery({
    queryKey: ["admin", "area-requests"],
    queryFn: async () => {
      // area_requests is newer than the generated types; admins read all rows via RLS.
      const { data, error } = await supabase
        .from("area_requests" as never)
        .select("user_id, lat, lng, created_at")
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return clusterAreaRequests((data ?? []) as unknown as AreaRequestRow[]);
    },
  });
}
