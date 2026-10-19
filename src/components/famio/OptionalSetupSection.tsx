import { useEffect, useState, type ReactNode } from "react";

export function setupGroupHasData(values: readonly (string | null | undefined)[]): boolean {
  return values.some((value) => !!value?.trim());
}

/** Keep children mounted so collapsing cannot reset their draft or change save payloads. */
export function OptionalSetupSection({
  title,
  hasData,
  children,
}: {
  title: string;
  hasData: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(hasData);
  useEffect(() => {
    if (hasData) setOpen(true);
  }, [hasData]);
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="rounded-2xl border border-border p-4"
    >
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-bold">{title}</summary>
      <div className="space-y-4 pt-2">{children}</div>
    </details>
  );
}
