import type { ReactNode } from "react";

export function AdminTable({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-x-auto rounded-xl border border-border/50 ${className}`}>
      <table className="w-full min-w-[640px] border-collapse text-sm">{children}</table>
    </div>
  );
}

export function AdminTableHead({ children }: { children: ReactNode }) {
  return (
    <thead className="sticky top-0 z-10 bg-surface-2/95 backdrop-blur-sm">
      <tr className="border-b border-border/60 text-start text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        {children}
      </tr>
    </thead>
  );
}

export function AdminTableTh({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return <th className={`px-3 py-2.5 font-bold ${className}`}>{children}</th>;
}

export function AdminTableBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-border/40 bg-surface">{children}</tbody>;
}

export function AdminTableRow({
  children,
  selected = false,
  onClick,
}: {
  children: ReactNode;
  selected?: boolean;
  onClick?: () => void;
}) {
  return (
    <tr
      onClick={onClick}
      className={`transition-colors ${onClick ? "cursor-pointer" : ""} ${
        selected ? "bg-brand/[0.06]" : "hover:bg-surface-2/60"
      }`}
    >
      {children}
    </tr>
  );
}

export function AdminTableTd({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <td className={`px-3 py-3 align-middle text-sm ${className}`}>{children}</td>;
}
