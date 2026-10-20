import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useCreateFamilyMember } from "@/lib/queries";
import { Page } from "@/ui/Page";
import { FamilyMemberForm } from "@/ui/FamilyMemberForm";
export default function NewMember() {
  const { t } = useTranslation();
  const create = useCreateFamilyMember();
  return (
    <Page title={t("familyMembers.addMember")}>
      <FamilyMemberForm
        busy={create.isPending}
        error={create.error}
        onSave={(v) => create.mutate(v, { onSuccess: () => router.replace("/family-members") })}
      />
    </Page>
  );
}
