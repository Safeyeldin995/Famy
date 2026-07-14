import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { PhoneFrame, TopBar, Card, EmptyState, ErrorState, ReasonDialog, PrimaryButton } from "@/components/famio/ui";
import { useFamilyMembers, useDeactivateFamilyMember } from "@/lib/db/family-members-queries";
import { ShieldCheck, Pencil, Trash2, Plus, Users } from "lucide-react";

export const Route = createFileRoute("/family-members")({ component: FamilyMembers });

function FamilyMembers() {
  const { t } = useTranslation();
  const membersQ = useFamilyMembers();
  const deactivate = useDeactivateFamilyMember();
  const [deactivateId, setDeactivateId] = useState<string | null>(null);

  const members = membersQ.data ?? [];

  return (
    <PhoneFrame>
      <TopBar back={{ to: "/profile" }} title={t("familyMembers.title", "Family Members")} />
      <div className="flex-1 space-y-3 px-5 pb-28 pt-2">
        <div className="flex items-start gap-2.5 rounded-2xl bg-mint/20 p-3.5 text-[11px] leading-relaxed text-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-navy" />
          <span>{t("familyMembers.privacyNotice", "Medical and access notes are only shared with the professional assigned to your booking, and only while that booking is active.")}</span>
        </div>

        {membersQ.isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-3xl bg-surface" />)
        ) : membersQ.isError ? (
          <ErrorState onRetry={() => membersQ.refetch()} />
        ) : members.length === 0 ? (
          <EmptyState
            emoji="👪"
            title={t("familyMembers.empty", "No family members yet")}
            body={t("familyMembers.emptyBody", "Add a family member to book services for them.")}
            action={
              <Link to="/family-members/new" className="focus-ring inline-flex items-center gap-1.5 rounded-2xl bg-navy px-4 py-3 text-sm font-bold text-navy-foreground">
                <Plus className="h-4 w-4" /> {t("familyMembers.addMember", "Add family member")}
              </Link>
            }
          />
        ) : (
          members.map((m: any) => {
            const relationshipLabel = m.relationship === "other" ? (m.relationship_other || t("familyMembers.relationships.other")) : t(`familyMembers.relationships.${m.relationship}`);
            return (
              <Card key={m.id} className={`p-4 ${!m.is_active ? "opacity-60" : ""}`}>
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-navy/10 text-navy">
                    <Users className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-bold">{m.full_name}</span>
                      {!m.is_active && (
                        <span className="inline-flex shrink-0 items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                          {t("familyMembers.inactive", "Inactive")}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{relationshipLabel}</p>
                  </div>
                </div>
                {m.is_active && (
                  <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
                    <Link
                      to="/family-members/$id"
                      params={{ id: m.id }}
                      className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-surface-2 py-2 text-[11px] font-bold"
                    >
                      <Pencil className="h-3 w-3" /> {t("common.edit")}
                    </Link>
                    <button
                      onClick={() => setDeactivateId(m.id)}
                      className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-coral/10 py-2 text-[11px] font-bold text-coral"
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
        <div className="safe-bottom fixed inset-x-0 bottom-0 z-40 mx-auto max-w-md border-t border-border bg-surface px-5 pt-3">
          <Link to="/family-members/new">
            <PrimaryButton>
              <Plus className="h-4 w-4" /> {t("familyMembers.addMember", "Add family member")}
            </PrimaryButton>
          </Link>
        </div>
      )}

      <ReasonDialog
        open={!!deactivateId}
        title={t("familyMembers.deactivateTitle", "Remove this family member?")}
        body={t("familyMembers.deactivateBody", "Past bookings for them are not affected. They just won't be selectable for new bookings.")}
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
            onError: (e: any) => toast.error(e?.message ?? t("common.somethingWentWrong")),
          });
        }}
      />
    </PhoneFrame>
  );
}
