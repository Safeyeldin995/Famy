import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useFamilyMember, useUpdateFamilyMember, type FamilyMemberInput } from "@/lib/queries";
import { Page, QueryState } from "@/ui/Page";
import { FamilyMemberForm } from "@/ui/FamilyMemberForm";
import { CustomerPageHeader } from "@/ui/CustomerPageHeader";
export default function EditMember() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const q = useFamilyMember(id);
  const update = useUpdateFamilyMember();
  return (
    <Page
      title={t("common.edit")}
      header={<CustomerPageHeader title={t("common.edit")} backTo="/family-members" />}
      contentStyle={{ paddingHorizontal: 24, gap: 20 }}
    >
      <QueryState query={q} empty={!q.data} emptyKey="familyMembers.notFound">
        {q.data && (
          <FamilyMemberForm
            key={id}
            initial={q.data as FamilyMemberInput}
            busy={update.isPending}
            error={update.error}
            onSave={(v) =>
              update.mutate({ ...v, id }, { onSuccess: () => router.replace("/family-members") })
            }
          />
        )}
      </QueryState>
    </Page>
  );
}
