import { Modal, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useCreateFamilyMember } from "@/lib/queries";
import { Page } from "../Page";
import { CustomerPageHeader } from "../CustomerPageHeader";
import { FamilyMemberForm } from "../FamilyMemberForm";
import { AddressEditor } from "./AddressEditor";

export function BookingInlineForm({
  kind,
  onClose,
  onSaved,
}: {
  kind: "member" | "address" | null;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { t } = useTranslation();
  const createMember = useCreateFamilyMember();
  return (
    <Modal transparent visible={kind !== null} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" }}>
        <View
          accessibilityViewIsModal
          style={{
            height: "92%",
            borderTopStartRadius: 24,
            borderTopEndRadius: 24,
            overflow: "hidden",
          }}
        >
          {kind === "address" ? (
            <AddressEditor onSaved={onSaved} onClose={onClose} />
          ) : kind === "member" ? (
            <Page
              title={t("familyMembers.addMember")}
              header={<CustomerPageHeader title={t("familyMembers.addMember")} onBack={onClose} />}
              contentStyle={{ paddingHorizontal: 24, gap: 20 }}
            >
              <FamilyMemberForm
                busy={createMember.isPending}
                error={createMember.error}
                onSave={(value) =>
                  createMember.mutate(value, { onSuccess: (row) => onSaved(row.id) })
                }
              />
            </Page>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
