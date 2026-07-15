import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Calendar, MessageCircle, User, ShieldCheck, AlertCircle, RefreshCw, Check } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAvatarUrl } from "@/lib/db/queries";
import { useCancellationReasons, type CancellationReasonRow } from "@/lib/db/cancellation-queries";
import { currentLang } from "@/lib/i18n";
import { BOOKING_TIMELINE_STEPS } from "@/lib/utils";

/**
 * Single shared avatar renderer for the whole app (Issue #4 fix). Resolves
 * the private `avatars` bucket's signed URL via useAvatarUrl() — the bucket
 * stays private, this only makes the existing signing pattern (previously
 * only in pro.profile.tsx) consistent everywhere an avatar is shown, instead
 * of duplicating the same signing logic in seven different call sites.
 */
export function Avatar({
  src,
  alt = "",
  className = "",
}: {
  src: string | null | undefined;
  alt?: string;
  className?: string;
}) {
  const q = useAvatarUrl(src);
  if (q.isLoading) return <div className={`animate-pulse bg-surface-2 ${className}`} />;
  if (!q.data) return <div className={`grid place-items-center bg-surface-2 text-muted-foreground ${className}`}><User className="h-1/2 w-1/2" /></div>;
  return <img src={q.data} alt={alt} className={`object-cover ${className}`} />;
}

export function PhoneFrame({ children, bg = "bg-surface-2" }: { children: ReactNode; bg?: string }) {
  return (
    <div className={`mx-auto flex min-h-dvh w-full max-w-md flex-col ${bg}`}>
      {children}
    </div>
  );
}

export function AppShell({
  children,
  hideNav = false,
  bg = "bg-surface-2",
}: {
  children: ReactNode;
  hideNav?: boolean;
  bg?: string;
}) {
  return (
    <PhoneFrame bg={bg}>
      <main className={`flex-1 ${hideNav ? "" : "pb-24"}`}>{children}</main>
      {!hideNav && <BottomNav />}
    </PhoneFrame>
  );
}

const tabs = [
  { to: "/home", labelKey: "nav.home", icon: Home },
  { to: "/bookings", labelKey: "nav.bookings", icon: Calendar },
  { to: "/messages", labelKey: "nav.messages", icon: MessageCircle },
  { to: "/profile", labelKey: "nav.profile", icon: User },
] as const;

export function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { t } = useTranslation();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40" aria-label="Primary">
      <div className="mx-auto max-w-md">
        <div className="safe-bottom mx-3 mb-3 rounded-3xl border border-border/60 bg-surface/95 shadow-float backdrop-blur-xl">
          <ul className="grid grid-cols-4">
            {tabs.map((tab) => {
              const active = pathname === tab.to || pathname.startsWith(tab.to + "/");
              const Icon = tab.icon;
              const label = t(tab.labelKey);
              return (
                <li key={tab.to}>
                  <Link
                    to={tab.to}
                    aria-label={label}
                    aria-current={active ? "page" : undefined}
                    className="focus-ring flex min-h-11 flex-col items-center gap-1 px-2 pt-3 pb-2 rounded-2xl"
                  >
                    <span
                      className={`grid h-9 w-12 place-items-center rounded-2xl transition-all ${
                        active ? "bg-navy text-navy-foreground" : "text-muted-foreground"
                      }`}
                    >
                      <Icon className="h-5 w-5" strokeWidth={2.2} />
                    </span>
                    <span
                      className={`text-[11px] font-semibold ${
                        active ? "text-navy" : "text-muted-foreground"
                      }`}
                    >
                      {label}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </nav>
  );
}

export function TopBar({
  title,
  back,
  right,
  transparent = false,
}: {
  title?: string;
  back?: { to: string } | (() => void);
  right?: ReactNode;
  transparent?: boolean;
}) {
  return (
    <div className={`safe-top sticky top-0 z-30 ${transparent ? "" : "bg-surface-2/90 backdrop-blur"}`}>
      <div className="flex items-center gap-2 px-4 py-3">
        {back && (
          <BackButton back={back} />
        )}
        {title && (
          <h1 className="flex-1 truncate text-base font-bold text-foreground">{title}</h1>
        )}
        {!title && <div className="flex-1" />}
        {right}
      </div>
    </div>
  );
}

export function BackButton({ back }: { back: { to: string } | (() => void) }) {
  const { t } = useTranslation();
  const cls = "focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface shadow-soft active:scale-95 transition-transform";
  if (typeof back === "function") {
    return (
      <button onClick={back} className={cls} aria-label={t("common.back")} data-rtl-flip="true">
        <ChevronLeft />
      </button>
    );
  }
  return (
    <Link to={back.to} className={cls} aria-label={t("common.back")} data-rtl-flip="true">
      <ChevronLeft />
    </Link>
  );
}

function ChevronLeft() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

export function PrimaryButton({
  children,
  onClick,
  type = "button",
  disabled,
  variant = "navy",
  className = "",
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  variant?: "navy" | "coral" | "ghost" | "outline";
  className?: string;
  "aria-label"?: string;
}) {
  const styles =
    variant === "navy"
      ? "bg-navy text-navy-foreground active:bg-navy/90 shadow-card hover:shadow-float"
      : variant === "coral"
      ? "bg-coral text-coral-foreground active:bg-coral/90 shadow-card hover:shadow-float"
      : variant === "outline"
      ? "border border-border bg-surface text-foreground"
      : "bg-transparent text-navy";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`focus-ring inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-base font-bold transition-all duration-200 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function Card({
  children,
  className = "",
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
}) {
  return (
    <div className={`rounded-3xl bg-surface shadow-soft ${className}`} onClick={onClick}>{children}</div>
  );
}

export function Chip({
  children,
  active,
  onClick,
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`focus-ring shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-all min-h-11 ${
        active
          ? "bg-navy text-navy-foreground shadow-soft"
          : "bg-surface text-foreground border border-border"
      }`}
    >
      {children}
    </button>
  );
}

export function Badge({ children, tone = "navy" }: { children: ReactNode; tone?: "navy" | "coral" | "mint" | "muted" }) {
  const map = {
    navy: "bg-navy/10 text-navy",
    coral: "bg-coral/10 text-coral",
    mint: "bg-mint/20 text-foreground",
    muted: "bg-muted text-muted-foreground",
  } as const;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${map[tone]}`}>
      {children}
    </span>
  );
}

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between px-5">
      <h2 className="text-lg font-extrabold tracking-tight text-foreground">{title}</h2>
      {action}
    </div>
  );
}

/* ----------------------------- Trust & states ----------------------------- */

export function TrustChip({
  children,
  icon,
  tone = "default",
}: {
  children: ReactNode;
  icon?: ReactNode;
  tone?: "default" | "success";
}) {
  const cls =
    tone === "success"
      ? "bg-mint/25 text-foreground"
      : "bg-surface text-foreground border border-border";
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${cls}`}>
      {icon ?? <ShieldCheck className="h-3 w-3 text-success" />}
      {children}
    </span>
  );
}

export function EmptyState({
  emoji = "✨",
  title,
  body,
  action,
}: {
  emoji?: string;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="py-16 text-center animate-rise">
      <div className="mx-auto grid h-24 w-24 place-items-center rounded-3xl bg-surface text-4xl shadow-soft">
        {emoji}
      </div>
      <div className="mt-5 text-base font-bold">{title}</div>
      {body && <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">{body}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title,
  body,
  onRetry,
}: {
  title?: string;
  body?: string;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="py-16 px-6 text-center animate-rise">
      <div className="mx-auto grid h-20 w-20 place-items-center rounded-3xl bg-coral/10 text-coral shadow-soft">
        <AlertCircle className="h-9 w-9" />
      </div>
      <div className="mt-5 text-base font-bold">{title ?? t("common.somethingWentWrong")}</div>
      <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">{body ?? t("common.tryAgainSoon")}</p>
      <div className="mt-5 flex justify-center gap-2">
        {onRetry && (
          <button
            onClick={onRetry}
            className="focus-ring inline-flex items-center gap-1.5 rounded-2xl bg-navy px-4 py-3 text-sm font-bold text-navy-foreground"
          >
            <RefreshCw className="h-4 w-4" /> {t("common.retry")}
          </button>
        )}
        <Link
          to="/home"
          className="focus-ring inline-flex items-center rounded-2xl border border-border bg-surface px-4 py-3 text-sm font-bold"
        >
          {t("common.backHome")}
        </Link>
      </div>
    </div>
  );
}

export function ProviderCardSkeleton() {
  return (
    <div className="rounded-3xl bg-surface p-4 shadow-soft" aria-hidden="true">
      <div className="flex items-center gap-3">
        <div className="skeleton h-16 w-16 rounded-2xl" />
        <div className="flex-1 space-y-2">
          <div className="skeleton h-3.5 w-2/3" />
          <div className="skeleton h-3 w-1/2" />
          <div className="flex gap-2 pt-1">
            <div className="skeleton h-4 w-14" />
            <div className="skeleton h-4 w-14" />
          </div>
        </div>
        <div className="space-y-2 text-right">
          <div className="skeleton ml-auto h-4 w-14" />
          <div className="skeleton ml-auto h-3 w-10" />
        </div>
      </div>
    </div>
  );
}

/* --------------------------- Booking lifecycle --------------------------- */

/**
 * Shared modal for any booking-lifecycle action that needs a confirmation
 * step, optionally with a required reason (decline/cancel/no-show/dispute).
 * Pass a distinct `key` at the call site when reusing one instance for
 * different action kinds so the textarea resets between them.
 */
export function ReasonDialog({
  open,
  title,
  body,
  reasonPlaceholder,
  confirmLabel,
  cancelLabel,
  confirmVariant = "coral",
  requireReason = true,
  pending = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  body?: string;
  reasonPlaceholder?: string;
  confirmLabel: string;
  cancelLabel: string;
  confirmVariant?: "coral" | "navy";
  requireReason?: boolean;
  pending?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  if (!open) return null;
  const canConfirm = !requireReason || reason.trim().length > 0;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-6" onClick={onCancel}>
      <Card className="w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <div className="text-base font-extrabold">{title}</div>
        {body && <div className="mt-1 text-xs text-muted-foreground">{body}</div>}
        {requireReason && (
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={reasonPlaceholder}
            className="mt-3 w-full resize-none rounded-2xl border border-border bg-surface-2 p-3 text-sm outline-none"
          />
        )}
        <div className="mt-4 flex gap-2">
          <button onClick={onCancel} disabled={pending} className="h-12 flex-1 rounded-2xl border border-border bg-surface text-sm font-bold disabled:opacity-50">
            {cancelLabel}
          </button>
          <button
            onClick={() => onConfirm(reason.trim())}
            disabled={pending || !canConfirm}
            className={`h-12 flex-1 rounded-2xl text-sm font-bold disabled:opacity-50 ${
              confirmVariant === "coral" ? "bg-coral text-coral-foreground" : "bg-navy text-navy-foreground"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </Card>
    </div>
  );
}

/**
 * Cancellation confirmation dialog — customer/provider pick from the
 * database-authoritative reason list (see cancel_booking() / Module 2), not
 * free text. The RPC re-validates reason/status/note server-side regardless
 * of what this form sends; this is UX, not the actual guard.
 */
export function CancelBookingDialog({
  open,
  actorType,
  bookingStatus,
  title,
  body,
  reasonLabel,
  notePlaceholder,
  confirmLabel,
  cancelLabel,
  pending = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  actorType: "customer" | "provider" | "admin";
  bookingStatus: string | undefined;
  title: string;
  body?: string;
  reasonLabel: string;
  notePlaceholder: string;
  confirmLabel: string;
  cancelLabel: string;
  pending?: boolean;
  onCancel: () => void;
  onConfirm: (reasonId: string, note: string) => void;
}) {
  const reasonsQ = useCancellationReasons(actorType);
  const [reasonId, setReasonId] = useState("");
  const [note, setNote] = useState("");
  const isAr = currentLang() === "ar";
  if (!open) return null;

  const reasons = (reasonsQ.data ?? []).filter(
    (r: CancellationReasonRow) => !bookingStatus || r.applicable_statuses.includes(bookingStatus as any),
  );
  const selected = reasons.find((r) => r.id === reasonId);
  const canConfirm = !!selected && (!selected.requires_note || note.trim().length > 0);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-6" onClick={onCancel}>
      <Card className="w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <div className="text-base font-extrabold">{title}</div>
        {body && <div className="mt-1 text-xs text-muted-foreground">{body}</div>}

        <label className="mt-3 block">
          <span className="text-xs font-semibold text-muted-foreground">{reasonLabel}</span>
          {reasonsQ.isLoading ? (
            <div className="mt-1 h-10 w-full animate-pulse rounded-2xl bg-surface-2" />
          ) : (
            <select
              value={reasonId}
              onChange={(e) => setReasonId(e.target.value)}
              className="mt-1 h-11 w-full rounded-2xl border border-border bg-surface-2 px-3 text-sm outline-none"
            >
              <option value="" disabled>{reasonLabel}</option>
              {reasons.map((r) => (
                <option key={r.id} value={r.id}>{isAr ? r.name_ar : r.name_en}</option>
              ))}
            </select>
          )}
        </label>

        {selected?.requires_note && (
          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={notePlaceholder}
            className="mt-3 w-full resize-none rounded-2xl border border-border bg-surface-2 p-3 text-sm outline-none"
          />
        )}

        <div className="mt-4 flex gap-2">
          <button onClick={onCancel} disabled={pending} className="h-12 flex-1 rounded-2xl border border-border bg-surface text-sm font-bold disabled:opacity-50">
            {cancelLabel}
          </button>
          <button
            onClick={() => onConfirm(reasonId, note.trim())}
            disabled={pending || !canConfirm}
            className="h-12 flex-1 rounded-2xl bg-coral text-sm font-bold text-coral-foreground disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </div>
      </Card>
    </div>
  );
}

/**
 * Shared dialog for the three Module 1 case-opening flows (support request,
 * dispute, no-show report) — same shell as ReasonDialog, with optional
 * category/subject/description fields and an optional evidence upload,
 * gated per-flow by the caller. Evidence is handed back as a raw File; the
 * caller uploads it (case-evidence bucket) before calling its RPC, so this
 * component stays storage-agnostic.
 */
export function CaseDialog({
  open,
  title,
  body,
  categoryOptions,
  categoryLabel,
  subjectLabel,
  subjectPlaceholder,
  reasonLabel,
  reasonPlaceholder,
  descriptionLabel,
  descriptionPlaceholder,
  showEvidence = false,
  evidenceLabel,
  confirmLabel,
  cancelLabel,
  pending = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  body?: string;
  categoryOptions?: { value: string; label: string }[];
  categoryLabel?: string;
  subjectLabel?: string;
  subjectPlaceholder?: string;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  descriptionLabel?: string;
  descriptionPlaceholder?: string;
  showEvidence?: boolean;
  evidenceLabel?: string;
  confirmLabel: string;
  cancelLabel: string;
  pending?: boolean;
  onCancel: () => void;
  onConfirm: (payload: { category?: string; subject?: string; reason: string; description?: string; evidenceFile?: File }) => void;
}) {
  const [category, setCategory] = useState(categoryOptions?.[0]?.value ?? "");
  const [subject, setSubject] = useState("");
  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");
  const [evidenceFile, setEvidenceFile] = useState<File | undefined>(undefined);
  if (!open) return null;

  const requiresSubject = !!subjectLabel;
  const requiresReason = !!reasonLabel;
  const requiresDescription = !!descriptionLabel;
  const canConfirm =
    (!requiresReason || reason.trim().length > 0)
    && (!requiresSubject || subject.trim().length > 0)
    && (!requiresDescription || description.trim().length >= 10);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-6" onClick={onCancel}>
      <Card className="max-h-[85vh] w-full max-w-sm overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="text-base font-extrabold">{title}</div>
        {body && <div className="mt-1 text-xs text-muted-foreground">{body}</div>}

        {categoryOptions && (
          <label className="mt-3 block">
            <span className="text-xs font-semibold text-muted-foreground">{categoryLabel}</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1 h-11 w-full rounded-2xl border border-border bg-surface-2 px-3 text-sm outline-none"
            >
              {categoryOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
        )}

        {requiresSubject && (
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder={subjectPlaceholder}
            className="mt-3 h-11 w-full rounded-2xl border border-border bg-surface-2 px-3 text-sm outline-none"
          />
        )}

        {requiresReason && (
          <textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={reasonPlaceholder}
            className="mt-3 w-full resize-none rounded-2xl border border-border bg-surface-2 p-3 text-sm outline-none"
          />
        )}

        {requiresDescription && (
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={descriptionPlaceholder}
            className="mt-3 w-full resize-none rounded-2xl border border-border bg-surface-2 p-3 text-sm outline-none"
          />
        )}

        {showEvidence && (
          <label className="mt-3 flex h-11 w-full cursor-pointer items-center justify-center rounded-2xl border-2 border-dashed border-border bg-surface-2 text-xs font-semibold text-muted-foreground">
            {evidenceFile ? evidenceFile.name : evidenceLabel}
            <input
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => setEvidenceFile(e.target.files?.[0])}
            />
          </label>
        )}

        <div className="mt-4 flex gap-2">
          <button onClick={onCancel} disabled={pending} className="h-12 flex-1 rounded-2xl border border-border bg-surface text-sm font-bold disabled:opacity-50">
            {cancelLabel}
          </button>
          <button
            onClick={() =>
              onConfirm({
                category: categoryOptions ? category : undefined,
                subject: requiresSubject ? subject.trim() : undefined,
                reason: reason.trim(),
                description: requiresDescription ? description.trim() : undefined,
                evidenceFile,
              })
            }
            disabled={pending || !canConfirm}
            className="h-12 flex-1 rounded-2xl bg-coral text-sm font-bold text-coral-foreground disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </div>
      </Card>
    </div>
  );
}

function caseTone(status: string): "mint" | "coral" | "muted" {
  if (status === "resolved" || status === "closed") return "mint";
  if (status === "rejected") return "muted";
  return "coral";
}

/** Compact list of any support tickets / dispute / no-show report tied to a
 * booking — the "current case status" surface required by Module 1. Shared
 * by both customer and provider booking-detail screens. No dedicated
 * timeline table; created_at/resolved_at + admin notes on the case row
 * itself are the timeline. */
export function SupportCasesCard({
  tickets,
  dispute,
  noShowReport,
  t,
}: {
  tickets: { id: string; subject: string; status: string; resolution_notes: string | null }[];
  dispute?: { reason: string; status: string; admin_notes: string | null };
  noShowReport?: { reason: string; status: string; admin_notes: string | null };
  t: (key: string, opts?: any) => string;
}) {
  if (tickets.length === 0 && !dispute && !noShowReport) return null;
  return (
    <Card className="mt-4 space-y-3 p-4">
      <div className="text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">{t("bookingDetail.yourCases")}</div>
      {tickets.map((tk) => (
        <div key={tk.id} className="rounded-xl bg-surface-2 p-3 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold">{tk.subject}</span>
            <Badge tone={caseTone(tk.status)}>{t(`bookingDetail.caseStatus.${tk.status}`, { defaultValue: tk.status })}</Badge>
          </div>
          {tk.resolution_notes && <p className="mt-1 text-muted-foreground">{tk.resolution_notes}</p>}
        </div>
      ))}
      {dispute && (
        <div className="rounded-xl bg-surface-2 p-3 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold">{t("bookingDetail.disputeCaseTitle")}</span>
            <Badge tone={caseTone(dispute.status)}>{t(`bookingDetail.caseStatus.${dispute.status}`, { defaultValue: dispute.status })}</Badge>
          </div>
          <p className="mt-1 text-muted-foreground">{dispute.reason}</p>
          {dispute.admin_notes && <p className="mt-1 text-muted-foreground">{dispute.admin_notes}</p>}
        </div>
      )}
      {noShowReport && (
        <div className="rounded-xl bg-surface-2 p-3 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold">{t("bookingDetail.noShowCaseTitle")}</span>
            <Badge tone={caseTone(noShowReport.status)}>{t(`bookingDetail.caseStatus.${noShowReport.status}`, { defaultValue: noShowReport.status })}</Badge>
          </div>
          <p className="mt-1 text-muted-foreground">{noShowReport.reason}</p>
          {noShowReport.admin_notes && <p className="mt-1 text-muted-foreground">{noShowReport.admin_notes}</p>}
        </div>
      )}
    </Card>
  );
}

/** Step tracker for the real booking_status lifecycle — no fabricated
 * per-step timestamps, just done/active/upcoming state derived from the
 * booking's current status. `labelFor` lets customer/provider screens pull
 * step labels from their own i18n namespace. */
export function BookingTimeline({
  status,
  labelFor,
}: {
  status: string;
  labelFor: (step: (typeof BOOKING_TIMELINE_STEPS)[number]) => string;
}) {
  const steps = BOOKING_TIMELINE_STEPS;
  const idx = steps.indexOf(status as (typeof steps)[number]);
  return (
    <ol className="relative">
      {steps.map((step, i) => {
        const done = idx >= 0 && i <= idx;
        const active = i === idx;
        return (
          <li key={step} className="flex gap-3 pb-4 last:pb-0">
            <div className="flex flex-col items-center">
              <span
                className={`grid h-6 w-6 place-items-center rounded-full ${
                  done ? "bg-navy text-navy-foreground" : "bg-muted text-muted-foreground"
                } ${active ? "ring-4 ring-coral/30" : ""}`}
              >
                {done ? <Check className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
              </span>
              {i < steps.length - 1 && <span className={`mt-1 w-0.5 flex-1 ${done ? "bg-navy" : "bg-border"}`} />}
            </div>
            <div className="pb-2 pt-0.5">
              <div className={`text-sm font-bold ${done ? "" : "text-muted-foreground"}`}>{labelFor(step)}</div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function ProviderTileSkeleton() {
  return (
    <div className="w-44 shrink-0 overflow-hidden rounded-3xl bg-surface shadow-soft" aria-hidden="true">
      <div className="skeleton h-40 w-full rounded-none" />
      <div className="space-y-2 p-3">
        <div className="skeleton h-3.5 w-3/4" />
        <div className="skeleton h-3 w-1/2" />
      </div>
    </div>
  );
}
