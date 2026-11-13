import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useCreateFamilyMember } from "@/lib/queries";
import { Page } from "@/ui/Page";
import { FamilyMemberForm } from "@/ui/FamilyMemberForm";
import { CustomerPageHeader } from "@/ui/CustomerPageHeader";
import { space } from "@/ui/theme";
import { useToast } from "@/ui/Toast";
export default function NewMember() {
  const { t } = useTranslation();
  const toast = useToast();
  const create = useCreateFamilyMember();
  return (
    <Page
      title={t("familyMembers.addMember")}
      header={<CustomerPageHeader title={t("familyMembers.addMember")} backTo="/family-members" />}
      contentStyle={{ paddingHorizontal: space.xxl, gap: space.xl }}
    >
      <FamilyMemberForm
        busy={create.isPending}
        error={create.error}
        onSave={(v) =>
          create.mutate(v, {
            onSuccess: () => {
              toast.show(t("familyMembers.saved"));
              router.replace("/family-members");
            },
          })
        }
      />
    </Page>
  );
}
