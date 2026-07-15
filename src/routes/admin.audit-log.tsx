import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAdminAuditLogs, useAdminAuditLogEntities, type AuditLogFilters, type AuditLogRow } from "@/lib/db/admin-audit-queries";
import { Search, ChevronLeft, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/admin/audit-log")({ component: AdminAuditLog });

const SENSITIVE_KEY_PATTERN = /password|token|secret|api[_-]?key|credential|authorization/i;

/**
 * Recursively strips sensitive-looking keys at every nesting depth, not
 * just the top level — this is the render-time backstop for legacy/
 * malformed audit rows written before server-side redaction existed (or by
 * a future column the deny-list hasn't caught up with yet), since those
 * rows are immutable and can never be rewritten in the database.
 */
function redactDeep(value: any): any {
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value !== null && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(k)) continue;
      out[k] = redactDeep(v);
    }
    return out;
  }
  return value;
}

function sanitizedEntries(obj: Record<string, any> | null | undefined): [string, any][] {
  if (!obj) return [];
  return Object.entries(redactDeep(obj) as Record<string, any>);
}

function formatValue(v: any): string {
  const redacted = redactDeep(v);
  if (redacted === null || redacted === undefined) return "—";
  if (typeof redacted === "object") return JSON.stringify(redacted);
  return String(redacted);
}

function actionTone(action: string) {
  if (action === "DELETE") return "bg-coral/10 text-coral";
  if (action === "INSERT") return "bg-mint/20 text-success";
  return "bg-amber-100 text-amber-700";
}

function AuditDetail({ row }: { row: AuditLogRow }) {
  const { t } = useTranslation();
  const hasOld = row.old_values && Object.keys(row.old_values).length > 0;
  const hasNew = row.new_values && Object.keys(row.new_values).length > 0;

  if (!hasOld && !hasNew) {
    return <p className="mt-3 text-xs text-muted-foreground">{t("admin.auditLog.noDetail")}</p>;
  }

  if (row.action === "UPDATE" && row.diff) {
    const changedKeys = sanitizedEntries(row.diff).map(([k]) => k);
    if (changedKeys.length === 0) {
      return <p className="mt-3 text-xs text-muted-foreground">{t("admin.auditLog.noChanges")}</p>;
    }
    return (
      <div dir="ltr" className="mt-3 overflow-x-auto rounded-xl border border-border/60">
        <table className="w-full text-left text-xs">
          <thead className="bg-surface-2 text-[10px] font-bold uppercase text-muted-foreground">
            <tr><th className="px-3 py-2">{t("admin.auditLog.field")}</th><th className="px-3 py-2">{t("admin.auditLog.before")}</th><th className="px-3 py-2">{t("admin.auditLog.after")}</th></tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {changedKeys.map((k) => (
              <tr key={k}>
                <td className="px-3 py-2 font-mono">{k}</td>
                <td className="px-3 py-2 text-muted-foreground">{formatValue(row.old_values?.[k])}</td>
                <td className="px-3 py-2 font-semibold">{formatValue(row.new_values?.[k])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const entries = row.action === "DELETE" ? sanitizedEntries(row.old_values) : sanitizedEntries(row.new_values);
  return (
    <div dir="ltr" className="mt-3 overflow-x-auto rounded-xl border border-border/60">
      <table className="w-full text-left text-xs">
        <thead className="bg-surface-2 text-[10px] font-bold uppercase text-muted-foreground">
          <tr><th className="px-3 py-2">{t("admin.auditLog.field")}</th><th className="px-3 py-2">{row.action === "DELETE" ? t("admin.auditLog.removedValue") : t("admin.auditLog.value")}</th></tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {entries.map(([k, v]) => (
            <tr key={k}><td className="px-3 py-2 font-mono">{k}</td><td className="px-3 py-2">{formatValue(v)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuditRow({ row, isOpen, onToggle }: { row: AuditLogRow; isOpen: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <li className="px-5 py-4">
      <button onClick={onToggle} className="focus-ring flex w-full flex-wrap items-start justify-between gap-3 text-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span dir="ltr" className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${actionTone(row.action)}`}>{row.action}</span>
            <span className="text-sm font-bold">{row.entity}</span>
            <span dir="ltr" className="font-mono text-[11px] text-muted-foreground">{row.entity_id?.slice(0, 8)}</span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {new Date(row.created_at).toLocaleString()} · {row.actor_name ?? t("admin.auditLog.system")} {row.actor_role ? `(${row.actor_role})` : ""}
          </p>
          {row.reason && <p className="mt-1 text-xs italic text-muted-foreground">"{row.reason}"</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-[11px]">
          {row.booking && (
            <Link to="/admin/bookings" search={{ status: row.booking.status }} onClick={(e) => e.stopPropagation()} className="font-semibold text-navy hover:underline">
              {t("admin.auditLog.booking")} <span dir="ltr">{row.booking_id?.slice(0, 8)}</span>
            </Link>
          )}
          <span className="text-muted-foreground">{isOpen ? t("admin.auditLog.hide") : t("admin.auditLog.details")}</span>
        </div>
      </button>
      {isOpen && <AuditDetail row={row} />}
    </li>
  );
}

function AdminAuditLog() {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<AuditLogFilters>({});
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const metaQ = useAdminAuditLogEntities();
  const q = useAdminAuditLogs(filters, page);

  const setFilter = (patch: Partial<AuditLogFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(0);
    setExpanded(null);
  };

  const total = q.data?.total ?? 0;
  const pageSize = q.data?.pageSize ?? 25;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="px-5 py-5 space-y-4">
      <div>
        <h1 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">{t("admin.layout.nav.auditLog")}</h1>
        <p className="text-xs text-muted-foreground">{t("admin.auditLog.subtitle")}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <select
          value={filters.action ?? ""}
          onChange={(e) => setFilter({ action: e.target.value || undefined })}
          className="focus-ring h-10 rounded-xl border border-border bg-surface px-3 text-sm"
        >
          <option value="">{t("admin.auditLog.allActions")}</option>
          {(metaQ.data?.actions ?? []).map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select
          value={filters.entity ?? ""}
          onChange={(e) => setFilter({ entity: e.target.value || undefined })}
          className="focus-ring h-10 rounded-xl border border-border bg-surface px-3 text-sm"
        >
          <option value="">{t("admin.auditLog.allEntities")}</option>
          {(metaQ.data?.entities ?? []).map((en) => <option key={en} value={en}>{en}</option>)}
        </select>
        <div className="flex h-10 items-center gap-1.5 rounded-xl border border-border bg-surface px-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            dir="ltr"
            defaultValue={filters.actorId ?? ""}
            onBlur={(e) => setFilter({ actorId: e.target.value.trim() || undefined })}
            placeholder={t("admin.auditLog.actorIdPlaceholder")}
            aria-label={t("admin.auditLog.actorIdPlaceholder")}
            className="w-full bg-transparent text-xs outline-none"
          />
        </div>
        <div className="flex h-10 items-center gap-1.5 rounded-xl border border-border bg-surface px-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            dir="ltr"
            defaultValue={filters.bookingId ?? ""}
            onBlur={(e) => setFilter({ bookingId: e.target.value.trim() || undefined })}
            placeholder={t("admin.auditLog.bookingIdPlaceholder")}
            aria-label={t("admin.auditLog.bookingIdPlaceholder")}
            className="w-full bg-transparent text-xs outline-none"
          />
        </div>
        <div className="flex h-10 items-center gap-1.5 rounded-xl border border-border bg-surface px-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            dir="ltr"
            defaultValue={filters.entityId ?? ""}
            onBlur={(e) => setFilter({ entityId: e.target.value.trim() || undefined })}
            placeholder={t("admin.auditLog.entityIdPlaceholder")}
            aria-label={t("admin.auditLog.entityIdPlaceholder")}
            className="w-full bg-transparent text-xs outline-none"
          />
        </div>
        <input
          type="date"
          aria-label={t("admin.auditLog.dateFrom")}
          onChange={(e) => setFilter({ dateFrom: e.target.value ? new Date(e.target.value).toISOString() : undefined })}
          className="focus-ring h-10 rounded-xl border border-border bg-surface px-3 text-sm"
        />
      </div>

      {q.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-muted" />)}
        </div>
      ) : q.isError ? (
        <div className="flex items-center gap-3 rounded-2xl border border-coral/30 bg-coral/5 p-4 text-sm text-coral">
          {t("admin.auditLog.loadError")}
          <button onClick={() => q.refetch()} className="focus-ring ms-auto rounded-lg border border-coral px-3 py-1 text-xs font-bold">{t("admin.operations.retry")}</button>
        </div>
      ) : (q.data?.rows.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">{t("admin.auditLog.noResults")}</p>
      ) : (
        <>
          <ul className="divide-y divide-border/60 rounded-2xl border border-border/60 bg-surface shadow-card">
            {q.data!.rows.map((row) => (
              <AuditRow key={row.id} row={row} isOpen={expanded === row.id} onToggle={() => setExpanded(expanded === row.id ? null : row.id)} />
            ))}
          </ul>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{t("admin.auditLog.pageOf", { page: page + 1, totalPages, total })}</span>
            <div className="flex gap-2">
              <button
                disabled={page === 0}
                onClick={() => { setPage((p) => Math.max(0, p - 1)); setExpanded(null); }}
                className="focus-ring inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 font-semibold disabled:opacity-40"
              ><ChevronLeft className="rtl-flip h-3.5 w-3.5" /> {t("admin.auditLog.prev")}</button>
              <button
                disabled={page + 1 >= totalPages}
                onClick={() => { setPage((p) => p + 1); setExpanded(null); }}
                className="focus-ring inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 font-semibold disabled:opacity-40"
              >{t("admin.auditLog.next")} <ChevronRight className="rtl-flip h-3.5 w-3.5" /></button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
