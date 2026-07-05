import { createFileRoute, Link } from "@tanstack/react-router";
import { useAdminProvider, useSetProviderVerified, useDocumentSignedUrl } from "@/lib/db/admin-queries";
import { ChevronLeft, FileText } from "lucide-react";

export const Route = createFileRoute("/admin/provider/$id")({ component: AdminProvider });

function AdminProvider() {
  const { id } = Route.useParams();
  const q = useAdminProvider(id);
  const setVerified = useSetProviderVerified();
  const sign = useDocumentSignedUrl();

  if (q.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  const p: any = q.data;
  if (!p) return <div className="p-6 text-sm text-muted-foreground">Not found.</div>;

  const openDoc = async (path: string) => {
    const url = await sign.mutateAsync(path);
    window.open(url, "_blank", "noopener");
  };

  return (
    <div className="px-5 py-4 space-y-4">
      <Link to="/admin/providers" className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground">
        <ChevronLeft className="h-4 w-4" /> Back
      </Link>

      <section className="rounded-2xl border border-border/60 bg-surface p-4 shadow-card">
        <h2 className="text-base font-extrabold">{p.profile?.full_name || "Unnamed"}</h2>
        <p className="text-xs text-muted-foreground">{p.profile?.phone} · {p.profile?.email}</p>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div><dt className="text-muted-foreground">City</dt><dd className="font-semibold">{p.city}</dd></div>
          <div><dt className="text-muted-foreground">Rate</dt><dd className="font-semibold">{p.hourly_rate} EGP/hr</dd></div>
          <div><dt className="text-muted-foreground">Experience</dt><dd className="font-semibold">{p.years_experience} years</dd></div>
          <div><dt className="text-muted-foreground">Status</dt><dd className="font-semibold">{p.is_verified ? "Verified" : "Pending"}</dd></div>
        </dl>
        {p.bio_en && <p className="mt-3 text-xs text-muted-foreground">{p.bio_en}</p>}
      </section>

      <section>
        <h3 className="mb-2 px-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">Documents</h3>
        {(p.documents ?? []).length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">No documents uploaded.</p>
        ) : (
          <ul className="space-y-2">
            {p.documents.map((d: any) => (
              <li key={d.id}>
                <button
                  onClick={() => openDoc(d.file_path)}
                  className="flex w-full items-center gap-3 rounded-xl border border-border/60 bg-surface p-3 text-left"
                >
                  <FileText className="h-4 w-4 text-navy" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{d.document_type}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{d.status} · {new Date(d.created_at).toLocaleDateString()}</p>
                  </div>
                  <span className="text-[11px] font-semibold text-coral">Open</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex gap-2 pt-2">
        <button
          disabled={setVerified.isPending}
          onClick={() => setVerified.mutate({ id: p.id, verified: true })}
          className="flex-1 rounded-xl bg-navy py-3 text-sm font-bold text-navy-foreground disabled:opacity-50"
        >Approve</button>
        <button
          disabled={setVerified.isPending}
          onClick={() => setVerified.mutate({ id: p.id, verified: false })}
          className="flex-1 rounded-xl border border-border py-3 text-sm font-bold disabled:opacity-50"
        >Reject</button>
      </div>
    </div>
  );
}
