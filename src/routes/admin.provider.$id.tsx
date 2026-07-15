import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useAdminProvider, useSetProviderVerified, useSetProviderActive, useSetProviderServiceStatus, useDocumentSignedUrl } from "@/lib/db/admin-queries";
import { useProviderAvailability, useProviderVacations, useAddVacation, useDeleteVacation } from "@/lib/db/provider-queries";
import { ChevronLeft, FileText, ShieldCheck, Trash2 } from "lucide-react";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function AvailabilitySection({ providerId }: { providerId: string }) {
  const rulesQ = useProviderAvailability(providerId);
  const vacQ = useProviderVacations(providerId);
  const addVac = useAddVacation();
  const delVac = useDeleteVacation();
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");

  const canBlock = !!start && !!end && reason.trim().length > 0;

  return (
    <section>
      <h3 className="mb-2 px-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">Availability</h3>
      <div className="rounded-xl border border-border/60 bg-surface p-3">
        <p className="text-[11px] font-bold text-muted-foreground">Weekly hours</p>
        {(rulesQ.data ?? []).length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">No weekly hours configured.</p>
        ) : (
          <ul className="mt-1 space-y-0.5 text-xs">
            {rulesQ.data!.map((r: any) => (
              <li key={r.id}>{DAY_LABELS[r.weekday]}: {r.start_time?.slice(0, 5)} – {r.end_time?.slice(0, 5)}</li>
            ))}
          </ul>
        )}

        <p className="mt-3 text-[11px] font-bold text-muted-foreground">Blocked periods</p>
        {(vacQ.data ?? []).length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">None.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {vacQ.data!.map((v: any) => (
              <li key={v.id} className="flex items-center justify-between text-xs">
                <span>{v.start_date} → {v.end_date}{v.reason ? ` — ${v.reason}` : ""}</span>
                <button onClick={() => delVac.mutate({ id: v.id, providerId })} className="text-muted-foreground hover:text-coral"><Trash2 className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 space-y-2 border-t border-border pt-3">
          <p className="text-[11px] font-bold text-muted-foreground">Block a period (audited — reason required)</p>
          <div className="flex flex-wrap gap-2">
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="h-9 rounded-lg border border-border bg-surface px-2 text-xs" />
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="h-9 rounded-lg border border-border bg-surface px-2 text-xs" />
          </div>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-xs" />
          <button
            disabled={!canBlock || addVac.isPending}
            onClick={() => { addVac.mutate({ providerId, start_date: start, end_date: end, reason }); setStart(""); setEnd(""); setReason(""); }}
            className="rounded-lg bg-coral px-3 py-1.5 text-xs font-bold text-coral-foreground disabled:opacity-50"
          >
            {addVac.isPending ? "Blocking…" : "Block period"}
          </button>
        </div>
      </div>
    </section>
  );
}

export const Route = createFileRoute("/admin/provider/$id")({ component: AdminProvider });

function AdminProvider() {
  const { id } = Route.useParams();
  const q = useAdminProvider(id);
  const setVerified = useSetProviderVerified();
  const setActive = useSetProviderActive();
  const setServiceStatus = useSetProviderServiceStatus();
  const sign = useDocumentSignedUrl();
  const [showConfirm, setShowConfirm] = useState(false);
  const [showRejectApplication, setShowRejectApplication] = useState(false);
  const [applicationRejectReason, setApplicationRejectReason] = useState("");
  const [rejectingServiceId, setRejectingServiceId] = useState<string | null>(null);
  const [serviceRejectReason, setServiceRejectReason] = useState("");

  if (q.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  const p: any = q.data;
  if (!p) return <div className="p-6 text-sm text-muted-foreground">Not found.</div>;

  const suspended = p.is_verified && !p.is_active;

  const openDoc = async (path: string) => {
    const url = await sign.mutateAsync(path);
    window.open(url, "_blank", "noopener");
  };

  const toggleSuspend = () => {
    setActive.mutate({ id: p.id, active: !p.is_active });
    setShowConfirm(false);
  };

  return (
    <div className="px-5 py-4 space-y-4">
      <Link to="/admin/providers" className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground">
        <ChevronLeft className="h-4 w-4" /> Back
      </Link>

      <section className="rounded-2xl border border-border/60 bg-surface p-4 shadow-card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-extrabold">{p.profile?.full_name || "Unnamed"}</h2>
            <p className="text-xs text-muted-foreground">{p.profile?.phone} · {p.profile?.email}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${p.is_verified ? "bg-mint/20 text-success" : "bg-amber-100 text-amber-700"}`}>
              {p.is_verified ? "Verified" : "Pending"}
            </span>
            {suspended && (
              <span className="rounded-full bg-coral/10 px-2 py-0.5 text-[10px] font-bold uppercase text-coral">Suspended</span>
            )}
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div><dt className="text-muted-foreground">City</dt><dd className="font-semibold">{p.city}</dd></div>
          <div><dt className="text-muted-foreground">Rate</dt><dd className="font-semibold">{p.hourly_rate} EGP/hr</dd></div>
          <div><dt className="text-muted-foreground">Experience</dt><dd className="font-semibold">{p.years_experience} years</dd></div>
          <div><dt className="text-muted-foreground">Trust score</dt><dd className="font-semibold">{Math.round(Number(p.trust?.score ?? 0))}</dd></div>
          <div><dt className="text-muted-foreground">Rating</dt><dd className="font-semibold">★ {Number(p.ratings?.rating_avg ?? 0).toFixed(1)}</dd></div>
          <div><dt className="text-muted-foreground">Completed jobs</dt><dd className="font-semibold">{Number(p.ratings?.rating_count ?? 0)}</dd></div>
        </dl>
        {p.bio_en && <p className="mt-3 text-xs text-muted-foreground">{p.bio_en}</p>}
      </section>

      <AvailabilitySection providerId={p.id} />

      <section>
        <h3 className="mb-2 px-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">Documents</h3>
        {(p.documents ?? []).length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">No documents uploaded.</p>
        ) : (
          <ul className="space-y-2">
            {p.documents.map((d: any) => (
              <li key={d.id}>
                <button
                  onClick={() => openDoc(d.storage_path)}
                  className="flex w-full items-center gap-3 rounded-xl border border-border/60 bg-surface p-3 text-left"
                >
                  <FileText className="h-4 w-4 text-navy" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{d.type}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{d.status} · {new Date(d.created_at).toLocaleDateString()}</p>
                  </div>
                  <span className="text-[11px] font-semibold text-coral">Open</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 px-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">Requested Services</h3>
        {(p.services ?? []).length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">No services requested.</p>
        ) : (
          <ul className="space-y-2">
            {p.services.map((ps: any) => (
              <li key={ps.id} className="rounded-xl border border-border/60 bg-surface p-3">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{ps.service?.name_en}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{ps.service?.category?.name_en} · {ps.status}</p>
                    {ps.status === "rejected" && ps.rejection_reason && (
                      <p className="mt-0.5 text-[11px] text-coral">Reason: {ps.rejection_reason}</p>
                    )}
                  </div>
                  {ps.status === "pending" && (
                    <div className="flex shrink-0 gap-1.5">
                      <button
                        disabled={setServiceStatus.isPending}
                        onClick={() => setServiceStatus.mutate(
                          { providerServiceId: ps.id, status: "approved" },
                          { onError: (e: any) => toast.error(e?.message ?? "Could not approve this service.") },
                        )}
                        className="rounded-lg bg-navy px-3 py-1.5 text-[11px] font-bold text-navy-foreground disabled:opacity-50"
                      >Approve</button>
                      <button
                        disabled={setServiceStatus.isPending}
                        onClick={() => { setRejectingServiceId(ps.id); setServiceRejectReason(""); }}
                        className="rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold disabled:opacity-50"
                      >Reject</button>
                    </div>
                  )}
                </div>
                {rejectingServiceId === ps.id && (
                  <div className="mt-2 space-y-2 rounded-lg border border-coral/30 bg-coral/5 p-2">
                    <p className="text-[11px] font-bold text-coral">Rejection reason (audited — required)</p>
                    <textarea
                      value={serviceRejectReason}
                      onChange={(e) => setServiceRejectReason(e.target.value)}
                      rows={2}
                      placeholder="Why is this service request being rejected?"
                      className="w-full resize-none rounded-lg border border-border bg-surface p-2 text-xs"
                    />
                    <div className="flex gap-2">
                      <button
                        disabled={!serviceRejectReason.trim() || setServiceStatus.isPending}
                        onClick={() => setServiceStatus.mutate(
                          { providerServiceId: ps.id, status: "rejected", reason: serviceRejectReason.trim() },
                          {
                            onSuccess: () => setRejectingServiceId(null),
                            onError: (e: any) => toast.error(e?.message ?? "Could not reject this service."),
                          },
                        )}
                        className="rounded-lg bg-coral px-3 py-1.5 text-[11px] font-bold text-coral-foreground disabled:opacity-50"
                      >Confirm reject</button>
                      <button onClick={() => setRejectingServiceId(null)} className="rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold">Cancel</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex gap-2 pt-2">
        {!p.is_verified ? (
          <>
            <button
              disabled={setVerified.isPending}
              onClick={() => setVerified.mutate(
                { id: p.id, verified: true },
                { onError: (e: any) => toast.error(e?.message ?? "Could not approve this provider.") },
              )}
              className="flex-1 rounded-xl bg-navy py-3 text-sm font-bold text-navy-foreground disabled:opacity-50"
            >Approve</button>
            <button
              disabled={setVerified.isPending}
              onClick={() => { setApplicationRejectReason(""); setShowRejectApplication(true); }}
              className="flex-1 rounded-xl border border-border py-3 text-sm font-bold disabled:opacity-50"
            >Reject</button>
          </>
        ) : (
          <button
            disabled={setActive.isPending}
            onClick={() => setShowConfirm(true)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold disabled:opacity-50 ${
              p.is_active ? "border border-coral text-coral" : "bg-navy text-navy-foreground"
            }`}
          >
            <ShieldCheck className="h-4 w-4" />
            {p.is_active ? "Suspend provider" : "Unsuspend provider"}
          </button>
        )}
      </div>

      {showConfirm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-6" onClick={() => setShowConfirm(false)}>
          <div className="w-full max-w-sm rounded-3xl bg-surface p-5" onClick={(e) => e.stopPropagation()}>
            <div className="text-base font-extrabold">
              {p.is_active ? "Suspend this provider?" : "Unsuspend this provider?"}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {p.is_active
                ? "The provider will be hidden from customers immediately and cannot receive new bookings until unsuspended."
                : "The provider will become visible and bookable to customers again."}
            </p>
            <div className="mt-4 flex gap-2">
              <button onClick={() => setShowConfirm(false)} className="h-11 flex-1 rounded-2xl border border-border bg-surface text-sm font-bold">Cancel</button>
              <button onClick={toggleSuspend} disabled={setActive.isPending} className="h-11 flex-1 rounded-2xl bg-coral text-sm font-bold text-coral-foreground disabled:opacity-50">
                {p.is_active ? "Confirm suspend" : "Unsuspend"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showRejectApplication && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-6" onClick={() => setShowRejectApplication(false)}>
          <div className="w-full max-w-sm rounded-3xl bg-surface p-5" onClick={(e) => e.stopPropagation()}>
            <div className="text-base font-extrabold">Reject this application?</div>
            <p className="mt-1 text-xs text-muted-foreground">This is an audited action. A reason is required.</p>
            <textarea
              value={applicationRejectReason}
              onChange={(e) => setApplicationRejectReason(e.target.value)}
              rows={3}
              placeholder="Reason (required)"
              className="mt-3 w-full resize-none rounded-xl border border-border bg-surface p-2 text-sm"
            />
            <div className="mt-4 flex gap-2">
              <button onClick={() => setShowRejectApplication(false)} className="h-11 flex-1 rounded-2xl border border-border bg-surface text-sm font-bold">Cancel</button>
              <button
                disabled={!applicationRejectReason.trim() || setVerified.isPending}
                onClick={() => setVerified.mutate(
                  { id: p.id, verified: false, reason: applicationRejectReason.trim() },
                  {
                    onSuccess: () => setShowRejectApplication(false),
                    onError: (e: any) => toast.error(e?.message ?? "Could not reject this provider."),
                  },
                )}
                className="h-11 flex-1 rounded-2xl bg-coral text-sm font-bold text-coral-foreground disabled:opacity-50"
              >Confirm reject</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
