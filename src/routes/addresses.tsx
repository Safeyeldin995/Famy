import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { PhoneFrame, TopBar, Card, EmptyState, ReasonDialog, PrimaryButton } from "@/components/famio/ui";
import { useAddresses, useDeleteAddress, useSetDefaultAddress } from "@/lib/db/queries";
import { Home, Briefcase, Users, MapPin, Star, Pencil, Trash2, Plus } from "lucide-react";

export const Route = createFileRoute("/addresses")({ component: Addresses });

const LABEL_ICON = { home: Home, work: Briefcase, family: Users, other: MapPin } as const;

function Addresses() {
  const { t } = useTranslation();
  const addressesQ = useAddresses();
  const deleteAddress = useDeleteAddress();
  const setDefault = useSetDefaultAddress();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const addresses = addressesQ.data ?? [];

  return (
    <PhoneFrame>
      <TopBar back={{ to: "/profile" }} title={t("addresses.title", "Saved Addresses")} />
      <div className="flex-1 space-y-3 px-5 pb-28 pt-2">
        {addressesQ.isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-3xl bg-surface" />)
        ) : addresses.length === 0 ? (
          <EmptyState
            emoji="📍"
            title={t("addresses.empty", "No saved addresses yet")}
            body={t("addresses.emptyBody", "Add an address to book services faster.")}
            action={
              <Link to="/addresses/new" className="focus-ring inline-flex items-center gap-1.5 rounded-2xl bg-navy px-4 py-3 text-sm font-bold text-navy-foreground">
                <Plus className="h-4 w-4" /> {t("addresses.addAddress", "Add address")}
              </Link>
            }
          />
        ) : (
          addresses.map((a: any) => {
            const Icon = LABEL_ICON[a.label as keyof typeof LABEL_ICON] ?? MapPin;
            const title = a.label === "other" ? a.custom_label || t("addresses.label.other") : t(`addresses.label.${a.label}`);
            const lineParts = [a.street ?? a.line1, a.building, a.compound, a.area].filter(Boolean);
            return (
              <Card key={a.id} className="p-4">
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-navy/10 text-navy">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-bold">{title}</span>
                      {a.is_default && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-coral/10 px-2 py-0.5 text-[10px] font-bold text-coral">
                          <Star className="h-2.5 w-2.5 fill-coral" /> {t("addresses.default", "Default")}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{lineParts.join(", ") || "—"}</p>
                    {(a.lat == null || a.lng == null) && (
                      <p className="mt-1 text-[10px] font-semibold text-coral">{t("addresses.missingLocation", "No location set")}</p>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
                  {!a.is_default && (
                    <button
                      onClick={() => setDefault.mutate(a.id, { onError: (e: any) => toast.error(e?.message ?? t("common.somethingWentWrong")) })}
                      disabled={setDefault.isPending}
                      className="flex-1 rounded-xl bg-surface-2 py-2 text-[11px] font-bold disabled:opacity-60"
                    >
                      {t("addresses.makeDefault", "Make default")}
                    </button>
                  )}
                  <Link
                    to="/addresses/$id"
                    params={{ id: a.id }}
                    className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-surface-2 py-2 text-[11px] font-bold"
                  >
                    <Pencil className="h-3 w-3" /> {t("common.edit")}
                  </Link>
                  <button
                    onClick={() => setDeleteId(a.id)}
                    className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-coral/10 py-2 text-[11px] font-bold text-coral"
                  >
                    <Trash2 className="h-3 w-3" /> {t("common.delete")}
                  </button>
                </div>
              </Card>
            );
          })
        )}
      </div>

      {addresses.length > 0 && (
        <div className="safe-bottom fixed inset-x-0 bottom-0 z-40 mx-auto max-w-md border-t border-border bg-surface px-5 pt-3">
          <Link to="/addresses/new">
            <PrimaryButton>
              <Plus className="h-4 w-4" /> {t("addresses.addAddress", "Add address")}
            </PrimaryButton>
          </Link>
        </div>
      )}

      <ReasonDialog
        open={!!deleteId}
        title={t("addresses.deleteTitle", "Delete this address?")}
        body={t("addresses.deleteBody", "Past bookings that used this address are not affected.")}
        confirmLabel={deleteAddress.isPending ? "…" : t("common.delete")}
        cancelLabel={t("common.cancel")}
        confirmVariant="coral"
        requireReason={false}
        pending={deleteAddress.isPending}
        onCancel={() => setDeleteId(null)}
        onConfirm={() => {
          if (!deleteId) return;
          deleteAddress.mutate(deleteId, {
            onSuccess: () => setDeleteId(null),
            onError: (e: any) => toast.error(e?.message ?? t("common.somethingWentWrong")),
          });
        }}
      />
    </PhoneFrame>
  );
}
