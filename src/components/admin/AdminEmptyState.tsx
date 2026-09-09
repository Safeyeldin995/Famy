import { Inbox } from "lucide-react";

export function AdminEmptyState({
  title,
  body,
}: {
  title: string;
  body?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/60 bg-surface-2/30 px-6 py-12 text-center">
      <Inbox className="h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
      <p className="mt-3 text-sm font-extrabold text-foreground">{title}</p>
      {body ? <p className="mt-1 max-w-sm text-xs font-medium text-muted-foreground">{body}</p> : null}
    </div>
  );
}
