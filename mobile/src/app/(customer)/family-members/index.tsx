import { useState } from "react";
import { memberAgeTranslation } from "@shared/familyMemberAge";
import { uiListSeparator } from "@shared/format/uiJoin";
import { View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFamilyMembers, useDeactivateFamilyMember } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { Page, QueryState, Confirm, ActionError, ui } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { CustomerPageHeader } from "@/ui/CustomerPageHeader";
import { Users, Plus, Pencil, Trash2 } from "lucide-react-native";
import { CustomerEmpty, customerStyle } from "@/ui/customer/Primitives";
import { colors, space } from "@/ui/theme";
import { useToast } from "@/ui/Toast";

export default function FamilyMembers() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const q = useFamilyMembers();
  const remove = useDeactivateFamilyMember();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const linkedQ = useQuery({
    queryKey: ["parent-linked-students"],
    queryFn: async () => {
      const { data, error } = await (
        supabase.rpc as unknown as (fn: string) => PromiseLike<{
          data: Array<{
            link_id: string;
            student_id: string;
            student_name: string;
            status: string;
          }> | null;
          error: { message: string } | null;
        }>
      )("parent_linked_students");
      if (error) throw error;
      return (data ?? []) as Array<{
        link_id: string;
        student_id: string;
        student_name: string;
        status: string;
      }>;
    },
  });
  const respond = useMutation({
    mutationFn: async (input: { linkId: string; approve: boolean }) => {
      const { error } = await (
        supabase.rpc as unknown as (
          fn: string,
          args: Record<string, unknown>,
        ) => PromiseLike<{ error: { message: string } | null }>
      )("respond_parent_link", {
        p_link_id: input.linkId,
        p_approve: input.approve,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["parent-linked-students"] });
    },
  });
  return (
    <Page
      title={t("familyMembers.title")}
      queries={[q, linkedQ]}
      footer={
        q.data?.length ? (
          <Button
            label={t("familyMembers.addMember")}
            icon={<Plus size={16} color="white" />}
            onPress={() => router.push("/family-members/new")}
          />
        ) : undefined
      }
      header={
        <CustomerPageHeader
          title={t("familyMembers.title")}
          subtitle={t("familyMembers.privacyNotice")}
          backTo="/profile"
        />
      }
    >
      {selected && (
        <Confirm
          title={t("familyMembers.deactivateTitle")}
          body={t("familyMembers.deactivateBody")}
          busy={remove.isPending}
          onCancel={() => setSelected(null)}
          onConfirm={() =>
            remove.mutate(selected, {
              onSuccess: () => {
                setSelected(null);
                toast.show(t("familyMembers.removed"));
              },
            })
          }
        />
      )}
      <ActionError error={remove.error} />
      {(linkedQ.data ?? []).length > 0 ? (
        <View style={{ gap: space.md, marginBottom: space.lg }}>
          <Text size="lg" weight="heavy">
            {t("familyMembers.linkedChildren")}
          </Text>
          {(linkedQ.data ?? []).map((row) => (
            <View key={row.link_id} style={[customerStyle.card, { borderRadius: 24 }]}>
              <Text size="lg" weight="heavy">
                {row.student_name}
              </Text>
              <Text size="xs" tone="muted">
                {row.status === "pending"
                  ? t("familyMembers.pendingApproval")
                  : t(`admin.studentLinks.status.${row.status}`)}
              </Text>
              {row.status === "pending" ? (
                <View style={{ flexDirection: "row", gap: space.sm, marginTop: space.md }}>
                  <Button
                    label={t("familyMembers.approveLink")}
                    style={{ flex: 1 }}
                    loading={respond.isPending}
                    onPress={() => respond.mutate({ linkId: row.link_id, approve: true })}
                  />
                  <Button
                    variant="secondary"
                    label={t("familyMembers.declineLink")}
                    style={{ flex: 1 }}
                    loading={respond.isPending}
                    onPress={() => respond.mutate({ linkId: row.link_id, approve: false })}
                  />
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
      <QueryState query={q}>
        {!q.data?.length ? (
          <CustomerEmpty
            Icon={Users}
            title={t("customerRound2.emptyFamily")}
            body={t("customerRound2.emptyFamilyBody")}
          >
            <Button
              label={t("familyMembers.addMember")}
              icon={<Plus size={16} color="white" />}
              onPress={() => router.push("/family-members/new")}
            />
          </CustomerEmpty>
        ) : null}
        {q.data?.map((m) => (
          <View
            key={m.id}
            style={[customerStyle.card, { borderRadius: 24, opacity: m.is_active ? 1 : 0.6 }]}
          >
            <View style={[customerStyle.row, { alignItems: "flex-start" }]}>
              <View style={customerStyle.icon}>
                <Text size="xl" weight="heavy" tone="brand">
                  {m.full_name.trim().slice(0, 1)}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text size="lg" weight="heavy">
                  {m.full_name}
                </Text>
                <Text size="xs" tone="muted">
                  {m.relationship === "other"
                    ? m.relationship_other || t("familyMembers.relationships.other")
                    : t(`familyMembers.relationships.${m.relationship}`)}
                  {uiListSeparator(i18n.language)}
                  {t(memberAgeTranslation(m.date_of_birth).key, {
                    count: memberAgeTranslation(m.date_of_birth).count,
                  })}
                </Text>
              </View>
            </View>
            {m.is_active ? (
              <View
                style={[
                  customerStyle.row,
                  {
                    borderTopWidth: 1,
                    borderTopColor: colors.border,
                    paddingTop: space.md,
                    gap: space.sm,
                  },
                ]}
              >
                <Button
                  variant="secondary"
                  label={t("common.edit")}
                  style={{ flex: 1, minHeight: 44, borderRadius: 999 }}
                  icon={<Pencil size={12} color={colors.foreground} />}
                  onPress={() =>
                    router.push({ pathname: "/family-members/[id]", params: { id: m.id } })
                  }
                />
                <Button
                  variant="ghost"
                  label={t("common.delete")}
                  style={{
                    flex: 1,
                    minHeight: 44,
                    borderRadius: 999,
                    backgroundColor: colors.brandTint,
                  }}
                  icon={<Trash2 size={12} color={colors.brand} />}
                  disabled={remove.isPending}
                  onPress={() => setSelected(m.id)}
                />
              </View>
            ) : (
              <Text tone="muted">{t("familyMembers.inactive")}</Text>
            )}
          </View>
        ))}
      </QueryState>
    </Page>
  );
}
