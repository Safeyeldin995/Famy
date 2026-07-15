import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  useAdminOperationsSummary, useAdminPendingProviderServices, useAdminFlaggedProviderPricing,
  useAdminPendingRequirementReviews, useAdminNotificationFailures, useAdminRetryNotification,
  type OperationsQueueKey,
} from "@/lib/db/admin-operations-queries";
import { AlertTriangle, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/admin/operations")({ component: AdminOperations });

function formatAge(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return "< 1h";
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function summaryFor(rows: { queue: OperationsQueueKey; item_count: number; oldest_at: string | null }[] | undefined, key: OperationsQueueKey) {
  return rows?.find((r) => r.queue === key) ?? { queue: key, item_count: 0, oldest_at: null };
}

function QueueCard({
  title, description, count, oldestAt, to, search,
}: {
  title: string;
  description: string;
  count: number;
  oldestAt: string | null;
  to: string;
  search?: Record<string, string>;
}) {
  return (
    <Link
      to={to as any}
      search={search as any}
      className="flex flex-col justify-between rounded-2xl border border-border/60 bg-surface p-4 shadow-card transition hover:border-navy/40"
    >
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{title}</p>
        <p className="mt-1 text-2xl font-extrabold">{count}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">{description}</p>
      </div>
      <p className="mt-3 text-[11px] font-semibold text-navy">
        {count > 0 ? `Oldest waiting ${formatAge(oldestAt)}` : "Nothing pending"}
      </p>
    </Link>
  );
}

function SectionShell({ title, count, isLoading, isError, isEmpty, children }: {
  title: string; count: number; isLoading: boolean; isError: boolean; isEmpty: boolean; children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border/60 bg-surface p-4 shadow-card">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{title}</h3>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold">{count}</span>
      </div>
      <div className="mt-3">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-muted" />)}
          </div>
        ) : isError ? (
          <p className="text-xs text-coral">Could not load this queue. Please refresh.</p>
        ) : isEmpty ? (
          <p className="text-xs text-muted-foreground">Nothing here right now.</p>
        ) : children}
      </div>
    </section>
  );
}

function PendingProviderServicesSection() {
  const q = useAdminPendingProviderServices();
  const rows = q.data ?? [];
  return (
    <SectionShell title="Pending provider-service approvals" count={rows.length} isLoading={q.isLoading} isError={q.isError} isEmpty={rows.length === 0}>
      <ul className="space-y-1.5">
        {rows.map((r: any) => (
          <li key={r.id} className="flex items-center justify-between gap-2 rounded-xl border border-border/60 p-2 text-xs">
            <div className="min-w-0">
              <span className="font-semibold">{r.provider?.profile?.full_name ?? r.provider_id.slice(0, 8)}</span>
              <span className="text-muted-foreground"> — {r.service?.name_en}</span>
              <p className="text-[10px] text-muted-foreground">Requested {new Date(r.created_at).toLocaleDateString()}</p>
            </div>
            <Link to="/admin/provider/$id" params={{ id: r.provider_id }} className="shrink-0 rounded-lg border border-border px-2 py-1 font-semibold text-navy">
              Review
            </Link>
          </li>
        ))}
      </ul>
    </SectionShell>
  );
}

function FlaggedProviderPricingSection() {
  const q = useAdminFlaggedProviderPricing();
  const rows = q.data ?? [];
  return (
    <SectionShell title="Flagged provider pricing" count={rows.length} isLoading={q.isLoading} isError={q.isError} isEmpty={rows.length === 0}>
      <ul className="space-y-1.5">
        {rows.map((r: any) => (
          <li key={r.id} className="flex items-center justify-between gap-2 rounded-xl border border-border/60 p-2 text-xs">
            <div className="min-w-0">
              <span className="font-semibold">{r.provider?.profile?.full_name ?? r.provider_id.slice(0, 8)}</span>
              <span className="text-muted-foreground"> — {r.service?.name_en} · {r.price_override} EGP</span>
            </div>
            <Link to="/admin/services" className="shrink-0 rounded-lg border border-border px-2 py-1 font-semibold text-navy">
              Review
            </Link>
          </li>
        ))}
      </ul>
    </SectionShell>
  );
}

function PendingRequirementReviewsSection() {
  const q = useAdminPendingRequirementReviews();
  const rows = q.data ?? [];
  return (
    <SectionShell title="Pending requirement/evidence reviews" count={rows.length} isLoading={q.isLoading} isError={q.isError} isEmpty={rows.length === 0}>
      <ul className="space-y-1.5">
        {rows.map((r: any) => (
          <li key={r.id} className="flex items-center justify-between gap-2 rounded-xl border border-border/60 p-2 text-xs">
            <div className="min-w-0">
              <span className="font-semibold">{r.provider?.profile?.full_name ?? r.provider_id.slice(0, 8)}</span>
              <span className="text-muted-foreground"> — {r.requirement?.name_en} ({r.requirement?.service?.name_en})</span>
              <p className="text-[10px] text-muted-foreground">
                {r.evidence_storage_path ? "Evidence submitted" : "No evidence uploaded"} · {new Date(r.created_at).toLocaleDateString()}
              </p>
            </div>
            <Link to="/admin/services" className="shrink-0 rounded-lg border border-border px-2 py-1 font-semibold text-navy">
              Review
            </Link>
          </li>
        ))}
      </ul>
    </SectionShell>
  );
}

function NotificationFailuresSection() {
  const q = useAdminNotificationFailures();
  const retry = useAdminRetryNotification();
  const rows = q.data ?? [];
  return (
    <SectionShell title="Notification delivery failures" count={rows.length} isLoading={q.isLoading} isError={q.isError} isEmpty={rows.length === 0}>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 rounded-xl border border-border/60 p-2 text-xs">
            <div className="min-w-0">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${r.status === "dead" ? "bg-coral/10 text-coral" : "bg-amber-100 text-amber-700"}`}>
                {r.status}
              </span>
              <span className="ml-2 text-muted-foreground">{r.attempts} attempt(s)</span>
              {r.last_error_safe && <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{r.last_error_safe}</p>}
              <p className="text-[10px] text-muted-foreground">{new Date(r.created_at).toLocaleString()}</p>
            </div>
            <button
              disabled={retry.isPending}
              onClick={() => retry.mutate(r.id, {
                onSuccess: () => toast.success("Notification requeued."),
                onError: (e: any) => toast.error(e?.message ?? "Could not retry this notification."),
              })}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-navy px-2 py-1 text-[11px] font-bold text-navy-foreground disabled:opacity-50"
            >
              <RefreshCw className="h-3 w-3" /> Retry
            </button>
          </li>
        ))}
      </ul>
    </SectionShell>
  );
}

function AdminOperations() {
  const summaryQ = useAdminOperationsSummary();
  const rows = summaryQ.data;

  return (
    <div className="px-5 py-5 space-y-5">
      <div>
        <h1 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Operations</h1>
        <p className="text-xs text-muted-foreground">Real work waiting on Famy admins — every queue below reflects the live database.</p>
      </div>

      {summaryQ.isLoading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-muted" />)}
        </div>
      ) : summaryQ.isError ? (
        <div className="flex items-center gap-2 rounded-2xl border border-coral/30 bg-coral/5 p-4 text-sm text-coral">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Could not load the operations summary.
          <button onClick={() => summaryQ.refetch()} className="ml-auto rounded-lg border border-coral px-3 py-1 text-xs font-bold">Retry</button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <QueueCard
            title="Open disputes"
            description="Awaiting admin review or resolution."
            count={summaryFor(rows, "open_disputes").item_count}
            oldestAt={summaryFor(rows, "open_disputes").oldest_at}
            to="/admin/cases" search={{ tab: "disputes", status: "open" }}
          />
          <QueueCard
            title="Open no-show reports"
            description="Awaiting admin review or resolution."
            count={summaryFor(rows, "open_no_show_reports").item_count}
            oldestAt={summaryFor(rows, "open_no_show_reports").oldest_at}
            to="/admin/cases" search={{ tab: "no_shows", status: "open" }}
          />
          <QueueCard
            title="Open support requests"
            description="Customer/provider tickets awaiting a response."
            count={summaryFor(rows, "open_support_tickets").item_count}
            oldestAt={summaryFor(rows, "open_support_tickets").oldest_at}
            to="/admin/cases" search={{ tab: "support", status: "open" }}
          />
          <QueueCard
            title="Stuck completion requests"
            description="Bookings awaiting customer confirmation."
            count={summaryFor(rows, "stuck_completion_requests").item_count}
            oldestAt={summaryFor(rows, "stuck_completion_requests").oldest_at}
            to="/admin/bookings" search={{ status: "completion_requested" }}
          />
          <QueueCard
            title="Payments needing review"
            description="Manual-transfer proofs pending review, or failed captures."
            count={summaryFor(rows, "payments_needing_review").item_count}
            oldestAt={summaryFor(rows, "payments_needing_review").oldest_at}
            to="/admin/payments" search={{ status: "pending_review" }}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PendingProviderServicesSection />
        <FlaggedProviderPricingSection />
        <PendingRequirementReviewsSection />
        <NotificationFailuresSection />
      </div>
    </div>
  );
}
