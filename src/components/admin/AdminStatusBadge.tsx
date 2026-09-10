import type { AdminTone } from "./statusTones";
import { adminToneClass, statusToTone } from "./statusTones";

export function AdminStatusBadge({
  children,
  tone,
  status,
  className = "",
}: {
  children: React.ReactNode;
  tone?: AdminTone;
  status?: string;
  className?: string;
}) {
  const resolved = tone ?? (status ? statusToTone(status) : "neutral");
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${adminToneClass(resolved)} ${className}`}
    >
      {children}
    </span>
  );
}
