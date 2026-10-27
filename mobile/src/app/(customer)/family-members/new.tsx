import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useCreateFamilyMember } from "@/lib/queries";
import { Page } from "@/ui/Page";
import { FamilyMemberForm } from "@/ui/FamilyMemberForm";
import { CustomerPageHeader } from "@/ui/CustomerPageHeader";
export default function NewMember() {
  const { t } = useTranslation();
  const create = useCreateFamilyMember();
  return (
    <Page
      title={t("familyMembers.addMember")}
      header={<CustomerPageHeader title={t("familyMembers.addMember")} backTo="/family-members" />}
      contentStyle={{ paddingHorizontal: 24, gap: 20 }}
    >
      <FamilyMemberForm
        busy={create.isPending}
        error={create.error}
        onSave={(v) => create.mutate(v, { onSuccess: () => router.replace("/family-members") })}
      />
    </Page>
  );
}
