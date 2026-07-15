import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  useAdminProviders, useSetProviderVerified, useSetProviderActive,
  type AdminProviderFilter,
} from "@/lib/db/admin-queries";
import { Search, ChevronRight, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/admin/providers")({ component: ProviderManagement });

const FILTERS: { key: AdminProviderFilter; label: string }[] = [
  { key: "pending", label: "Pending verification" },
  { key: "verified", label: "Verified" },
  { key: "suspended", label: "Suspended" },
  { key: "all", label: "All" },
];

function ProviderManagement() {
  const [filter, setFilter] = useState<AdminProviderFilter>("pending");
  const [query, setQuery] = useState("");
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const q = useAdminProviders(filter);
  const setVerified = useSetProviderVerified();
  const setActive = useSetProviderActive();

  const rows = useMemo(() => {
    const all = q.data ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((p: any) => {
      const name = String(p.profile?.full_name ?? "").toLowerCase();
      const phone = String(p.profile?.phone ?? "").toLowerCase();
      const city = String(p.city ?? "").toLowerCase();
      return name.includes(needle) || phone.includes(needle) || city.includes(needle);
    });
  }, [q.data, query]);

  return (
    <div className="px-5 py-5 space-y-4">
      <div>
        <h1 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Provider Management</h1>
        <p className="text-xs text-muted-foreground">Verify new applications, review documents, and manage active/suspended status.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-10 min-w-[240px] flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, phone or city…"
            className="w-full bg-transparent text-sm outline-none"
          />
        </div>
        <div className="flex gap-1 rounded-xl border border-border bg-surface p-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold ${filter === f.key ? "bg-navy text-navy-foreground" : "text-muted-foreground"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {q.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-muted" />)}
        </div>
      ) : q.isError ? (
        <p className="text-sm text-coral">Could not load providers. Please refresh.</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No providers match this search/filter.</p>
      ) : (
        <ul className="divide-y divide-border/60 rounded-2xl border border-border/60 bg-surface shadow-card">
          {rows.map((p: any) => {
            const suspended = p.is_verified && !p.is_active;
            return (
              <li key={p.id} className="px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <Link to="/admin/provider/$id" params={{ id: p.id }} className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{p.profile?.full_name || "Unnamed provider"}</p>
                    <p className="truncate text-xs text-muted-foreground">{p.city} · {p.hourly_rate} EGP/hr · {p.years_experience}y exp</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">{p.profile?.phone}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] font-semibold">
                      <span className="text-navy">Trust {Math.round(Number(p.trust?.score ?? 0))}</span>
                      <span className="text-amber-600">★ {Number(p.ratings?.rating_avg ?? 0).toFixed(1)}</span>
                      <span className="text-muted-foreground">{Number(p.ratings?.rating_count ?? 0)} jobs</span>
                    </div>
                  </Link>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${p.is_verified ? "bg-mint/20 text-success" : "bg-amber-100 text-amber-700"}`}>
                      {p.is_verified ? "Verified" : "Pending"}
                    </span>
                    {suspended && (
                      <span className="rounded-full bg-coral/10 px-2 py-0.5 text-[10px] font-bold uppercase text-coral">Suspended</span>
                    )}
                    <ChevronRight className="mt-1 h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {!p.is_verified ? (
                    <>
                      <button
                        disabled={setVerified.isPending}
                        onClick={() => setVerified.mutate(
                          { id: p.id, verified: true },
                          { onError: (e: any) => toast.error(e?.message ?? "Could not approve this provider.") },
                        )}
                        className="rounded-xl bg-navy px-4 py-2 text-xs font-bold text-navy-foreground disabled:opacity-50"
                      >Approve</button>
                      <button
                        disabled={setVerified.isPending}
                        onClick={() => { setRejectingId(p.id); setRejectReason(""); }}
                        className="rounded-xl border border-border px-4 py-2 text-xs font-bold disabled:opacity-50"
                      >Reject</button>
                    </>
                  ) : (
                    <button
                      disabled={setActive.isPending}
                      onClick={() => setActive.mutate({ id: p.id, active: !p.is_active })}
                      className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold disabled:opacity-50 ${
                        p.is_active ? "border border-coral text-coral" : "bg-navy text-navy-foreground"
                      }`}
                    >
                      <ShieldCheck className="h-3.5 w-3.5" />
                      {p.is_active ? "Suspend" : "Unsuspend"}
                    </button>
                  )}
                </div>
                {rejectingId === p.id && (
                  <div className="mt-3 space-y-2 rounded-xl border border-coral/30 bg-coral/5 p-3">
                    <p className="text-[11px] font-bold text-coral">Rejection reason (audited — required)</p>
                    <textarea
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      rows={2}
                      placeholder="Why is this application being rejected?"
                      className="w-full resize-none rounded-lg border border-border bg-surface p-2 text-xs"
                    />
                    <div className="flex gap-2">
                      <button
                        disabled={!rejectReason.trim() || setVerified.isPending}
                        onClick={() => setVerified.mutate(
                          { id: p.id, verified: false, reason: rejectReason.trim() },
                          {
                            onSuccess: () => setRejectingId(null),
                            onError: (e: any) => toast.error(e?.message ?? "Could not reject this provider."),
                          },
                        )}
                        className="rounded-lg bg-coral px-3 py-1.5 text-xs font-bold text-coral-foreground disabled:opacity-50"
                      >Confirm reject</button>
                      <button onClick={() => setRejectingId(null)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold">Cancel</button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
