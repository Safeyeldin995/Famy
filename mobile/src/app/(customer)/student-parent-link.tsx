import { useState } from "react";
import { View, StyleSheet } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Page, ActionError, Field } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { CustomerPageHeader } from "@/ui/CustomerPageHeader";
import { space } from "@/ui/theme";
import { useToast } from "@/ui/Toast";
import {
  useParentAcknowledgeStudentLink,
  useParentFlagNotMyChild,
  useParentLinkedStudents,
  useSaveParentGuardianContact,
  useStudentParentLinkStatus,
} from "@/lib/studentParentLinkQueries";

export default function StudentParentLinkScreen() {
  const { t } = useTranslation();
  const toast = useToast();
  const { linkId } = useLocalSearchParams<{ linkId?: string }>();
  const statusQ = useStudentParentLinkStatus();
  const linkedStudentsQ = useParentLinkedStudents();
  const save = useSaveParentGuardianContact();
  const [editing, setEditing] = useState(false);
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
          error={save.error || acknowledge.error || flag.error}
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
        ) : statusQ.data && !editing ? (
          <>
            <Text tone="muted">
              {statusQ.data.status === "linked"
                ? t("studentParentLink.linkedState")
                : statusQ.data.status === "flagged_not_my_child"
                  ? t("studentParentLink.flaggedState")
                  : t("studentParentLink.notifiedState")}
            </Text>
            <Button
              variant="secondary"
              label={t("studentParentLink.changeContact")}
              onPress={() => setEditing(true)}
            />
          </>
        ) : (
          <>
            <Text tone="muted">{t("studentParentLink.lead")}</Text>
            <Field
              label={t("studentParentLink.parentPhone")}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              placeholder={t("studentParentLink.parentPhoneHint")}
              ltr
            />
            <Field
              label={t("studentParentLink.parentEmail")}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={t("studentParentLink.parentEmailHint")}
              ltr
            />
            <Button
              label={t("studentParentLink.sendRequest")}
              loading={save.isPending}
              disabled={!phone.trim() || !email.trim()}
              onPress={() =>
                save.mutate(
                  { parentPhone: phone.trim(), parentEmail: email.trim() },
                  {
                    onSuccess: () => {
                      setEditing(false);
                      setPhone("");
                      setEmail("");
                      toast.show(t("studentParentLink.requestSent"));
                    },
                  },
                )
              }
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
});