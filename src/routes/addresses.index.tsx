import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { PhoneFrame, EmptyState, ReasonDialog, PrimaryButton } from "@/components/famio/ui";
import { CustomerPageHero } from "@/components/famio/CustomerPageHero";
import { CustomerFloatingPanel } from "@/components/famio/CustomerFloatingPanel";
import { QueryError } from "@/components/famio/QueryError";
import { useAddresses, useDeleteAddress, useSetDefaultAddress } from "@/lib/db/queries";
import { previewAddressPath, previewPath } from "@/lib/preview/previewPath";
import { Home, Briefcase, Users, MapPin, Star, Pencil, Trash2, Plus } from "lucide-react";

export const Route = createFileRoute("/addresses/")({ component: Addresses });

const LABEL_ICON = { home: Home, work: Briefcase, family: Users, other: MapPin } as const;

function Addresses() {
  const { t } = useTranslation();
  const addressesQ = useAddresses();
  const deleteAddress = useDeleteAddress();
  const setDefault = useSetDefaultAddress();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const addresses = addressesQ.data ?? [];
  const hasAddresses = addresses.length > 0;

  return (
    <PhoneFrame bg="bg-background">
      <CustomerPageHero
        title={t("addresses.title", "Saved Addresses")}
        subtitle={hasAddresses ? t("addresses.subtitle") : t("addresses.emptyBody")}
        backTo="/profile"
      />

      {hasAddresses ? (
        <div className="px-5">
          <CustomerFloatingPanel className="!p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-extrabold text-foreground">
                  {t("addresses.summary", { count: addresses.length })}
                </p>
                <p className="mt-0.5 text-xs font-semibold text-muted-foreground">
                  {t("addresses.subtitle")}
                </p>
              </div>
              <Link
                to={previewPath("/addresses/new") as "/addresses/new"}
                className="focus-ring tap-scale inline-flex shrink-0 items-center gap-1.5 rounded-full bg-brand px-4 py-2.5 text-xs font-extrabold text-brand-foreground"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                {t("addresses.addAddress", "Add address")}
              </Link>
            </div>
          </CustomerFloatingPanel>
        </div>
      ) : null}

      <div className={`flex-1 space-y-2.5 px-5 pb-10 ${hasAddresses ? "mt-5" : "pt-2"}`}>
        {addressesQ.isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-[2rem] bg-surface-2" />
          ))
        ) : addressesQ.isError ? (
          <QueryError onRetry={() => addressesQ.refetch()} />
        ) : !hasAddresses ? (
          <EmptyState
            icon="map-pin"
            title={t("addresses.empty", "No saved addresses yet")}
            body={t("addresses.emptyBody", "Add an address to book services faster.")}
            action={
              <Link to={previewPath("/addresses/new") as "/addresses/new"}>
                <PrimaryButton className="!h-12 px-6">
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  {t("addresses.addAddress", "Add address")}
                </PrimaryButton>
              </Link>
            }
          />
        ) : (
          addresses.map((a: any) => {
            const Icon = LABEL_ICON[a.label as keyof typeof LABEL_ICON] ?? MapPin;
            const title =
              a.label === "other"
                ? a.custom_label || t("addresses.label.other")
                : t(`addresses.label.${a.label}`);
            const lineParts = [a.street ?? a.line1, a.building, a.compound, a.area].filter(Boolean);
            return (
              <article
                key={a.id}
                className="overflow-hidden rounded-[1.75rem] border border-border/50 bg-surface-elevated shadow-sm"
              >
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand/8 text-brand">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[15px] font-extrabold text-foreground">
                          {title}
                        </span>
                        {a.is_default ? (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand/8 px-2 py-0.5 text-[10px] font-bold text-brand">
                            <Star className="h-2.5 w-2.5 fill-brand" aria-hidden="true" />
                            {t("addresses.default", "Default")}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-xs font-medium text-muted-foreground">
                        {lineParts.join(", ") || "—"}
                      </p>
                      {(a.lat == null || a.lng == null) && (
                        <p className="mt-1 text-[10px] font-semibold text-brand">
                          {t("addresses.missingLocation", "No location set")}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 border-t border-border/70 px-4 pb-4 pt-3">
                  {!a.is_default ? (
                    <button
                      type="button"
                      onClick={() =>
                        setDefault.mutate(a.id, {
                          onError: (e: any) =>
                            toast.error(e?.message ?? t("common.somethingWentWrong")),
                        })
                      }
                      disabled={setDefault.isPending}
                      className="focus-ring flex-1 rounded-full bg-surface-2 py-2.5 text-[11px] font-extrabold disabled:opacity-60"
                    >
                      {t("addresses.makeDefault", "Make default")}
                    </button>
                  ) : null}
                  <Link
                    to={previewAddressPath(a.id) as any}
                    className="focus-ring flex flex-1 items-center justify-center gap-1 rounded-full bg-surface-2 py-2.5 text-[11px] font-extrabold"
                  >
                    <Pencil className="h-3 w-3" aria-hidden="true" />
                    {t("common.edit")}
                  </Link>
                  <button
                    type="button"
                    onClick={() => setDeleteId(a.id)}
                    className="focus-ring flex flex-1 items-center justify-center gap-1 rounded-full bg-brand/8 py-2.5 text-[11px] font-extrabold text-brand"
                  >
                    <Trash2 className="h-3 w-3" aria-hidden="true" />
                    {t("common.delete")}
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>

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
