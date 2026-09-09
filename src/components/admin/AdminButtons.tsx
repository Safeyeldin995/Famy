import type { ButtonHTMLAttributes, ReactNode } from "react";

const base = "focus-ring inline-flex items-center justify-center gap-1.5 rounded-lg text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50";

export function AdminPrimaryButton({
  children,
  className = "",
  size = "md",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { size?: "sm" | "md" }) {
  const pad = size === "sm" ? "px-3 py-1.5" : "px-4 py-2";
  return (
    <button type="button" className={`${base} ${pad} bg-brand text-brand-foreground hover:bg-brand/90 ${className}`} {...props}>
      {children}
    </button>
  );
}

export function AdminSecondaryButton({
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`${base} px-4 py-2 border border-border/60 bg-surface text-foreground hover:bg-surface-2 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function AdminDangerButton({
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`${base} px-4 py-2 border border-destructive/40 bg-surface text-destructive hover:bg-destructive/5 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function AdminLinkButton({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`text-xs font-bold text-brand ${className}`}>{children}</span>;
}
