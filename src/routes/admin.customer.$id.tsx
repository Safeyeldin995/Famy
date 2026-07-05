import { createFileRoute, Link } from "@tanstack/react-router";
import { useAdminCustomer } from "@/lib/db/admin-queries";
import { ChevronLeft } from "lucide-react";

export const Route = createFileRoute("/admin/customer/$id")({ component: AdminCustomer });

function AdminCustomer() {
  const { id } = Route.useParams();
  const q = useAdminCustomer(id);

  if (q.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  const { profile, bookings } = q.data ?? { profile: null, bookings: [] };
  if (!profile) return <div className="p-6 text-sm text-muted-foreground">Customer not found.</div>;

  return (
    <div className="px-5 py-4 space-y-4">
      <Link to="/admin/bookings" className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground">
        <ChevronLeft className="h-4 w-4" /> Back
      </Link>

      <section className="rounded-2xl border border-border/60 bg-surface p-4 shadow-card">
        <h2 className="text-base font-extrabold">{profile.full_name || "Unnamed"}</h2>
        <p className="text-xs text-muted-foreground">{profile.phone}</p>
        {profile.email && <p className="text-xs text-muted-foreground">{profile.email}</p>}
        <p className="mt-2 text-[11px] text-muted-foreground">Joined {new Date(profile.created_at).toLocaleDateString()}</p>
      </section>

      <section>
        <h3 className="mb-2 px-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">Recent bookings ({bookings.length})</h3>
        {bookings.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">No bookings.</p>
        ) : (
          <ul className="space-y-2">
            {bookings.map((b: any) => (
              <li key={b.id} className="flex items-center justify-between rounded-xl border border-border/60 bg-surface p-3 text-xs">
                <div>
                  <p className="font-semibold">{new Date(b.scheduled_start).toLocaleString()}</p>
                  <p className="text-muted-foreground">{b.price_total} EGP</p>
                </div>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase">{b.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
