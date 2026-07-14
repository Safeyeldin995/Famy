import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { PhoneFrame, TopBar } from "@/components/famio/ui";
import { FamilyMemberForm, emptyFamilyMemberFormValue, familyMemberFormValueToInput } from "@/components/famio/FamilyMemberForm";
import { useCreateFamilyMember } from "@/lib/db/family-members-queries";

export const Route = createFileRoute("/family-members/new")({ component: NewFamilyMember });

function NewFamilyMember() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const createMember = useCreateFamilyMember();
  const [value, setValue] = useState(emptyFamilyMemberFormValue());

  const submit = async () => {
    try {
      await createMember.mutateAsync(familyMemberFormValueToInput(value));
      toast.success(t("familyMembers.saved", "Family member saved"));
      nav({ to: "/family-members" });
    } catch (e: any) {
      toast.error(e?.message ?? t("common.somethingWentWrong"));
    }
  };

  return (
    <PhoneFrame bg="bg-surface">
      <TopBar back={{ to: "/family-members" }} title={t("familyMembers.addMember", "Add family member")} />
      <div className="flex-1 px-6 pb-10 pt-2">
        <FamilyMemberForm
          value={value}
          onChange={setValue}
          onSubmit={submit}
          submitting={createMember.isPending}
          submitLabel={t("common.save")}
        />
      </div>
    </PhoneFrame>
  );
}
