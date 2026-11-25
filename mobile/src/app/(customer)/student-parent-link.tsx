import { useState } from "react";
import { View, TextInput, StyleSheet } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Page, ActionError } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { CustomerPageHeader } from "@/ui/CustomerPageHeader";
import { colors, radius, space } from "@/ui/theme";
import { useToast } from "@/ui/Toast";
import {
  useParentAcknowledgeStudentLink,
  useParentFlagNotMyChild,
  useParentLinkedStudents,
  useRegisterParentGuardianContact,
  useStudentParentLinkStatus,
  useUpdateParentGuardianContact,
} from "@/lib/studentParentLinkQueries";

export default function StudentParentLinkScreen() {
  const { t } = useTranslation();
  const toast = useToast();
  const { linkId } = useLocalSearchParams<{ linkId?: string }>();
  const statusQ = useStudentParentLinkStatus();
  const linkedStudentsQ = useParentLinkedStudents();
  const register = useRegisterParentGuardianContact();
  const update = useUpdateParentGuardianContact();
  const acknowledge = useParentAcknowledgeStudentLink();
  const flag = useParentFlagNotMyChild();
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const parentCard = linkedStudentsQ.data?.find(
    (row: { link_id: string; status: string }) =>
      linkId ? row.link_id === linkId : row.status === "linked",
  );

  const isParentCard = !!linkId || !!parentCard;

  return (
    <Page
      title={t("studentParentLink.title")}
      queries={[statusQ, linkedStudentsQ]}
      header={
        <CustomerPageHeader
          title={t("studentParentLink.title")}
          backTo={isParentCard ? "/notifications" : "/profile"}
        />
      }
    >
      <View style={styles.stack}>
        <ActionError
          error={register.error || update.error || acknowledge.error || flag.error}
        />
        {isParentCard && parentCard ? (
          <>
            <Text>{parentCard.student_name}</Text>
            <Text tone="muted">{t("studentParentLink.parentCardBody")}</Text>
            <Button
              label={t("studentParentLink.acknowledge")}
              loading={acknowledge.isPending}
              onPress={() =>
                acknowledge.mutate(parentCard.link_id, {
                  onSuccess: () => {
                    toast.show(t("studentParentLink.acknowledgedToast"));
                    router.replace("/family-members");
                  },
                })
              }
            />
            <Button
              variant="secondary"
              label={t("studentParentLink.notMyChild")}
              loading={flag.isPending}
              onPress={() =>
                flag.mutate(parentCard.link_id, {
                  onSuccess: () => {
                    toast.show(t("studentParentLink.flaggedToast"));
                    router.back();
                  },
                })
              }
            />
          </>
        ) : statusQ.data?.status === "linked" ? (
          <Text tone="muted">{t("studentParentLink.linkedState")}</Text>
        ) : statusQ.data?.status === "notified" ? (
          <Text tone="muted">{t("studentParentLink.notifiedState")}</Text>
        ) : statusQ.data?.status === "flagged_not_my_child" ? (
          <Text tone="muted">{t("studentParentLink.flaggedState")}</Text>
        ) : (
          <>
            <Text tone="muted">{t("studentParentLink.lead")}</Text>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              placeholder={t("studentParentLink.parentPhone")}
              style={styles.input}
            />
            <TextInput
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              placeholder={t("studentParentLink.parentEmail")}
              style={styles.input}
            />
            <Button
              label={t("studentParentLink.sendRequest")}
              loading={register.isPending || update.isPending}
              disabled={!phone.trim() || !email.trim()}
              onPress={() => {
                const mutation = statusQ.data ? update : register;
                mutation.mutate(
                  { parentPhone: phone.trim(), parentEmail: email.trim() },
                  {
                    onSuccess: () => toast.show(t("studentParentLink.requestSent")),
                  },
                );
              }}
            />
          </>
        )}
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: space.md,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space.md,
    color: colors.foreground,
  },
});