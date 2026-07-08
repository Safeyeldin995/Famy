import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Calendar, MessageCircle, User, ShieldCheck, AlertCircle, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAvatarUrl } from "@/lib/db/queries";

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

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-3xl bg-surface shadow-soft ${className}`}>{children}</div>
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
