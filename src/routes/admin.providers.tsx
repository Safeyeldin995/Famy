import { createFileRoute, Link } from "@tanstack/react-router";
import { usePendingProviders, useSetProviderVerified } from "@/lib/db/admin-queries";
import { ChevronRight } from "lucide-react";

export const Route = createFileRoute("/admin/providers")({ component: PendingProviders });

function PendingProviders() {
  const q = usePendingProviders();
  const setVerified = useSetProviderVerified();

  if (q.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  const rows = q.data ?? [];
  if (rows.length === 0) return <div className="p-6 text-sm text-muted-foreground">No pending applications.</div>;

  return (
    <ul className="divide-y divide-border/60">
      {rows.map((p: any) => (
        <li key={p.id} className="px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <Link to="/admin/provider/$id" params={{ id: p.id }} className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">{p.profile?.full_name || "Unnamed provider"}</p>
              <p className="truncate text-xs text-muted-foreground">{p.city} · {p.hourly_rate} EGP/hr · {p.years_experience}y exp</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{p.profile?.phone}</p>
            </Link>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="mt-3 flex gap-2">
            <button
              disabled={setVerified.isPending}
              onClick={() => setVerified.mutate({ id: p.id, verified: true })}
              className="flex-1 rounded-xl bg-navy py-2 text-xs font-bold text-navy-foreground disabled:opacity-50"
            >Approve</button>
            <button
              disabled={setVerified.isPending}
              onClick={() => setVerified.mutate({ id: p.id, verified: false })}
              className="flex-1 rounded-xl border border-border py-2 text-xs font-bold disabled:opacity-50"
            >Reject</button>
          </div>
        </li>
      ))}
    </ul>
  );
}
