import { createFileRoute, Link } from "@tanstack/react-router";
import { usePendingProviders, useAdminBookings } from "@/lib/db/admin-queries";
import { ShieldCheck, ClipboardList } from "lucide-react";

export const Route = createFileRoute("/admin/")({ component: AdminHome });

function AdminHome() {
  const pending = usePendingProviders();
  const bookings = useAdminBookings();
  return (
    <div className="px-5 py-5 space-y-3">
      <Link to="/admin/providers" className="flex items-center justify-between rounded-2xl border border-border/60 bg-surface p-4 shadow-card">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-5 w-5 text-coral" />
          <div>
            <p className="text-sm font-bold">Pending providers</p>
            <p className="text-xs text-muted-foreground">Approve or reject new applications</p>
          </div>
        </div>
        <span className="rounded-full bg-coral/10 px-2 py-0.5 text-xs font-bold text-coral">
          {pending.data?.length ?? 0}
        </span>
      </Link>
      <Link to="/admin/bookings" className="flex items-center justify-between rounded-2xl border border-border/60 bg-surface p-4 shadow-card">
        <div className="flex items-center gap-3">
          <ClipboardList className="h-5 w-5 text-navy" />
          <div>
            <p className="text-sm font-bold">Bookings</p>
            <p className="text-xs text-muted-foreground">View and change booking status</p>
          </div>
        </div>
        <span className="rounded-full bg-navy/10 px-2 py-0.5 text-xs font-bold text-navy">
          {bookings.data?.length ?? 0}
        </span>
      </Link>
    </div>
  );
}
