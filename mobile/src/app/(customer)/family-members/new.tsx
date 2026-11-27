import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useCreateFamilyMember } from "@/lib/queries";
import { rememberLearnerChoice } from "@/lib/studentMatchQueries";
import { Page } from "@/ui/Page";
import { FamilyMemberForm } from "@/ui/FamilyMemberForm";
import { CustomerPageHeader } from "@/ui/CustomerPageHeader";
import { space } from "@/ui/theme";
import { useToast } from "@/ui/Toast";

/** `?return=back`: opened from «ضيف ابن»; go back there with the new child selected. */
export default function NewMember() {
  const { t } = useTranslation();
  const toast = useToast();
  const create = useCreateFamilyMember();
  const { return: returnTo } = useLocalSearchParams<{ return?: string }>();
  const returnBack = returnTo === "back";
  return (
    <Page
      title={t("familyMembers.addMember")}
      header={
        returnBack ? (
          <CustomerPageHeader title={t("familyMembers.addMember")} onBack={() => router.back()} />
        ) : (
          <CustomerPageHeader title={t("familyMembers.addMember")} backTo="/family-members" />
        )
      }
      contentStyle={{ paddingHorizontal: space.xxl, gap: space.xl }}
    >
      <FamilyMemberForm
        busy={create.isPending}
        error={create.error}
        onSave={(v) =>
          create.mutate(v, {
            onSuccess: (row) => {
              toast.show(t("familyMembers.saved"));
              if (returnBack && router.canGoBack()) {
                rememberLearnerChoice(row.id);
                router.back();
              } else {
                router.replace("/family-members");
              }
            },
          })
        }
      />
    </Page>
  );
}
