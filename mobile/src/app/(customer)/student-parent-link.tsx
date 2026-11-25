import { useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Page, ActionError } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { CustomerPageHeader } from "@/ui/CustomerPageHeader";
import { AuthTextField } from "@/ui/auth/AuthFields";
import { space } from "@/ui/theme";
import { useToast } from "@/ui/Toast";
import {
  useRequestParentLink,
  useRespondParentLink,
  useStudentParentLinkStatus,
} from "@/lib/studentParentLinkQueries";

export default function StudentParentLinkScreen() {
  const { t } = useTranslation();
  const toast = useToast();
  const { linkId } = useLocalSearchParams<{ linkId?: string }>();
  const statusQ = useStudentParentLinkStatus();
  const request = useRequestParentLink();
  const respond = useRespondParentLink();
  const [phone, setPhone] = useState("");

  const isParentApproval = !!linkId;

  return (
    <Page
      title={t("studentParentLink.title")}
      queries={[statusQ]}
      header={
        <CustomerPageHeader
          title={t("studentParentLink.title")}
          backTo={isParentApproval ? "/notifications" : "/profile"}
        />
      }
    >
      <View style={{ gap: space.md }}>
        <ActionError error={request.error || respond.error} />
        {isParentApproval ? (
          <>
            <Text>{t("studentParentLink.parentApprovalBody")}</Text>
            <Button
              label={t("studentParentLink.approve")}
              loading={respond.isPending}
              onPress={() =>
                respond.mutate(
                  { linkId: String(linkId), approve: true },
                  {
                    onSuccess: () => {
                      toast.show(t("studentParentLink.approvedToast"));
                      router.replace("/family-members");
                    },
                  },
                )
              }
            />
            <Button
              variant="secondary"
              label={t("studentParentLink.decline")}
              loading={respond.isPending}
              onPress={() =>
                respond.mutate(
                  { linkId: String(linkId), approve: false },
                  {
                    onSuccess: () => {
                      toast.show(t("studentParentLink.declinedToast"));
                      router.back();
                    },
                  },
                )
              }
            />
          </>
        ) : statusQ.data?.status === "pending" ? (
          <Text tone="muted">{t("studentParentLink.pending")}</Text>
        ) : statusQ.data?.status === "approved" ? (
          <Text tone="muted">{t("studentParentLink.approvedState")}</Text>
        ) : (
          <>
            <Text tone="muted">{t("studentParentLink.lead")}</Text>
            <AuthTextField
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              placeholder={t("studentParentLink.parentPhone")}
              textAlign="left"
            />
            <Button
              label={t("studentParentLink.sendRequest")}
              loading={request.isPending}
              disabled={!phone.trim()}
              onPress={() =>
                request.mutate(phone.trim(), {
                  onSuccess: (result) => {
                    toast.show(
                      t(
                        result.outcome === "not_on_famy"
                          ? "studentParentLink.notOnFamy"
                          : "studentParentLink.requestSent",
                      ),
                    );
                  },
                })
              }
            />
          </>
        )}
      </View>
    </Page>
  );
}