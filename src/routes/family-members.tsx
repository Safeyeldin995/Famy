import { isPreviewRoute } from "@/lib/preview/constants";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  PhoneFrame,
  Card,
  EmptyState,
  ErrorState,
  ReasonDialog,
  PrimaryButton,
} from "@/components/famio/ui";
import { CustomerPageHeader } from "@/components/famio/CustomerPageHeader";
import { useFamilyMembers, useDeactivateFamilyMember } from "@/lib/db/family-members-queries";
import { ProfileAvatar } from "@/components/provider/ProfileAvatar";
import { Pencil, Trash2, Plus } from "lucide-react";

export function FamilyMembers() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const membersQ = useFamilyMembers();
  const deactivate = useDeactivateFamilyMember();
  const [deactivateId, setDeactivateId] = useState<string | null>(null);

  const members = membersQ.data ?? [];

  return (
    <PhoneFrame bg="bg-background">
      <CustomerPageHeader
        title={t("familyMembers.title", "Family Members")}
        subtitle={t("familyMembers.privacyNotice")}
        backTo="/profile"
      />
      <div className="flex-1 space-y-3 px-5 pb-28 pt-4">
        {membersQ.isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-3xl bg-surface-2" />
          ))
        ) : membersQ.isError ? (
          <ErrorState onRetry={() => membersQ.refetch()} />
        ) : members.length === 0 ? (
          <EmptyState
            icon="users"
            title={t("customerRound2.emptyFamily")}
            body={t("customerRound2.emptyFamilyBody")}
            action={
              <Link
                to={isPreviewRoute() ? "/preview/family-members" : "/family-members/new"}
                search={isPreviewRoute() ? { memberId: "new" } : {}}
                className="focus-ring inline-flex items-center gap-1.5 rounded-2xl bg-brand px-5 py-3 text-pro-14 font-extrabold text-brand-foreground"
              >
                <Plus className="h-4 w-4" /> {t("familyMembers.addMember", "Add family member")}
              </Link>
            }
          />
        ) : (
          members.map((m: any) => {
            const relationshipLabel =
              m.relationship === "other"
                ? m.relationship_other || t("familyMembers.relationships.other")
                : t(`familyMembers.relationships.${m.relationship}`);
            return (
              <Card key={m.id} className={`p-4 ${!m.is_active ? "opacity-60" : ""}`}>
                <div className="flex items-start gap-3">
                  <ProfileAvatar
                    name={m.full_name}
                    className="h-12 w-12 rounded-full text-pro-18"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-pro-16 font-extrabold">{m.full_name}</span>
                      {!m.is_active && (
                        <span className="inline-flex shrink-0 items-center rounded-full bg-muted px-2 py-0.5 text-pro-12 font-bold text-muted-foreground">
                          {t("familyMembers.inactive", "Inactive")}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-pro-12 text-muted-foreground">
                      {relationshipLabel}
                    </p>
                  </div>
                </div>
                {m.is_active && (
                  <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
                    <Link
                      to={isPreviewRoute() ? "/preview/family-members" : "/family-members/$id"}
                      search={isPreviewRoute() ? { memberId: m.id } : {}}
                      params={{ id: m.id }}
                      className="focus-ring flex flex-1 items-center justify-center gap-1 rounded-full bg-surface-2 min-h-11 py-2.5 text-pro-12 font-extrabold"
                    >
                      <Pencil className="h-3 w-3" /> {t("common.edit")}
                    </Link>
                    <button
                      onClick={() => setDeactivateId(m.id)}
                      className="focus-ring flex flex-1 items-center justify-center gap-1 rounded-full bg-brand/8 min-h-11 py-2.5 text-pro-12 font-extrabold text-brand"
                    >
                      <Trash2 className="h-3 w-3" /> {t("common.delete")}
                    </button>
                  </div>
                )}
              </Card>
            );
          })
        )}
      </div>

      {members.length > 0 && (
        <div className="action-bar safe-bottom px-5 pt-3">
          <PrimaryButton
            onClick={() =>
              nav({
                to: isPreviewRoute() ? "/preview/family-members" : "/family-members/new",
                search: isPreviewRoute() ? { memberId: "new" } : {},
              })
            }
          >
            <Plus className="h-4 w-4" /> {t("familyMembers.addMember", "Add family member")}
          </PrimaryButton>
        </div>
      )}

      <ReasonDialog
        open={!!deactivateId}
        title={t("familyMembers.deactivateTitle", "Remove this family member?")}
        body={t(
          "familyMembers.deactivateBody",
          "Past bookings for them are not affected. They just won't be selectable for new bookings.",
        )}
        confirmLabel={deactivate.isPending ? "…" : t("common.delete")}
        cancelLabel={t("common.cancel")}
        confirmVariant="coral"
        requireReason={false}
        pending={deactivate.isPending}
        onCancel={() => setDeactivateId(null)}
        onConfirm={() => {
          if (!deactivateId) return;
          deactivate.mutate(deactivateId, {
            onSuccess: () => setDeactivateId(null),
            onError: () => toast.error(t("common.somethingWentWrong")),
          });
        }}
      />
    </PhoneFrame>
  );
}

export const Route = createFileRoute("/family-members")({ component: FamilyMembers });
