import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useAdminPayments } from "@/lib/db/admin-queries";
import { getSignedProofUrl } from "@/lib/db/payment-queries";
import { formatEGP } from "@/lib/utils";
import { Search, ExternalLink, Eye } from "lucide-react";

export const Route = createFileRoute("/admin/payments")({
  component: AdminPayments,
  validateSearch: (search: Record<string, unknown>): { status?: string } => ({
    ...(typeof search.status === "string" ? { status: search.status } : {}),
  }),
});

const STATUS_OPTIONS = [
  "pending", "pending_review", "authorized", "captured", "rejected", "failed", "refunded", "partially_refunded",
] as const;

function statusTone(status: string) {
  if (status === "captured") return "bg-mint/20 text-success";
  if (status === "rejected" || status === "failed") return "bg-coral/10 text-coral";
  if (status === "pending" || status === "pending_review" || status === "authorized") return "bg-amber-100 text-amber-700";
  return "bg-muted text-muted-foreground";
}

function AdminPayments() {
  const search = Route.useSearch();
  const [status, setStatus] = useState<string>(search.status ?? "");
  const [query, setQuery] = useState("");
  const q = useAdminPayments(status || undefined);

  const rows = useMemo(() => {
    const all = q.data ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((p: any) => {
      const bookingId = String(p.booking_id ?? "").toLowerCase();
      const paymentId = String(p.id ?? "").toLowerCase();
      const customerName = String(p.booking?.customer?.full_name ?? "").toLowerCase();
      const customerPhone = String(p.booking?.customer?.phone ?? "").toLowerCase();
      const providerName = String(p.booking?.provider?.profile?.full_name ?? "").toLowerCase();
      return (
        bookingId.includes(needle) ||
        paymentId.includes(needle) ||
        customerName.includes(needle) ||
        customerPhone.includes(needle) ||
        providerName.includes(needle)
      );
    });
  }, [q.data, query]);

  const openProof = async (path: string | null) => {
    if (!path) return;
    try {
      const url = await getSignedProofUrl(path);
      window.open(url, "_blank", "noopener");
    } catch {
      // signed URL failures are surfaced by the browser failing to open a blank tab; no separate toast infra exists on this admin screen.
    }
  };

  return (
    <div className="px-5 py-5 space-y-4">
      <div>
        <h1 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Payments</h1>
        <p className="text-xs text-muted-foreground">Finance & fraud review — search or filter, open the related booking for full capture/reject actions.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-10 min-w-[260px] flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by booking ID, payment ID, customer or provider…"
            className="w-full bg-transparent text-sm outline-none"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="h-10 rounded-xl border border-border bg-surface px-3 text-sm"
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {q.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-muted" />)}
        </div>
      ) : q.isError ? (
        <p className="text-sm text-coral">Could not load payments. Please refresh.</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No payments match this search/filter.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border/60 bg-surface shadow-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border/60 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Booking</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Method</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Proof</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.map((p: any) => (
                <tr key={p.id}>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{p.booking_id?.slice(0, 8)}</td>
                  <td className="px-4 py-3">
                    <div className="font-semibold">{p.booking?.customer?.full_name || "—"}</div>
                    <div className="text-xs text-muted-foreground">{p.booking?.customer?.phone}</div>
                  </td>
                  <td className="px-4 py-3">{p.booking?.provider?.profile?.full_name || "—"}</td>
                  <td className="px-4 py-3 capitalize">{p.payment_method_name_en || p.method || "—"}</td>
                  <td className="px-4 py-3 font-semibold">{formatEGP(Number(p.amount ?? 0))}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${statusTone(p.status)}`}>{p.status}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(p.created_at).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    {p.proof_path ? (
                      <button onClick={() => openProof(p.proof_path)} className="inline-flex items-center gap-1 text-xs font-semibold text-navy">
                        <Eye className="h-3.5 w-3.5" /> View
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      to="/admin/bookings"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-navy"
                    >
                      Open bookings <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
