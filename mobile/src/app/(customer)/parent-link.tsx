import { useState } from "react";
import { TextInput, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { isValidE164Phone, normalizePhoneE164 } from "@shared/otp/normalizePhone";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { Page } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { CustomerPageHeader } from "@/ui/CustomerPageHeader";
import { useToast } from "@/ui/Toast";
import { colors, radius, space } from "@/ui/theme";

type LinkRow = {
  id: string;
  status: "pending" | "approved" | "rejected" | "revoked";
};

export default function ParentLinkScreen() {
  const { t } = useTranslation();
  const toast = useToast();
  const { session } = useSession();
  const userId = session?.user?.id;
  const qc = useQueryClient();
  const [phone, setPhone] = useState("");

  const linkQ = useQuery({
    queryKey: ["student-parent-link", "mine", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("student_parent_links")
        .select("id, status")
        .eq("student_id", userId!)
        .in("status", ["pending", "approved"])
        .order("requested_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as LinkRow | null) ?? null;
    },
  });

  const request = useMutation({
    mutationFn: async (raw: string) => {
      const { data, error } = await (
        supabase.rpc as unknown as (
          fn: string,
          args: Record<string, unknown>,
        ) => PromiseLike<{
          data: { parent_found: boolean } | null;
          error: { message: string } | null;
        }>
      )("request_parent_link", {
        p_parent_phone: raw,
      });
      if (error) throw error;
      return data as { parent_found: boolean };
    },
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ["student-parent-link"] });
      toast.show(data.parent_found ? t("parentLink.sent") : t("parentLink.notOnFamy"));
    },
    onError: (error: Error) => {
      if (error.message.includes("PARENT_LINK_RATE_LIMITED"))
        toast.show(t("parentLink.rateLimited"));
      else if (error.message.includes("PARENT_LINK_INVALID_PHONE"))
        toast.show(t("parentLink.invalidPhone"));
      else toast.show(error.message);
    },
  });

  const unlink = useMutation({
    mutationFn: async (linkId: string) => {
      const { error } = await (
        supabase.rpc as unknown as (
          fn: string,
          args: Record<string, unknown>,
        ) => PromiseLike<{ error: { message: string } | null }>
      )("revoke_parent_link", { p_link_id: linkId });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["student-parent-link"] });
      toast.show(t("parentLink.revoked"));
    },
  });

  const status = linkQ.data?.status;
  return (
    <Page
      title={t("parentLink.title")}
      queries={[linkQ]}
      header={<CustomerPageHeader title={t("parentLink.title")} backTo="/profile" />}
    >
      <View style={{ gap: space.md }}>
        <Text tone="muted">{t("parentLink.lead")}</Text>
        {status === "approved" ? <Text weight="bold">{t("parentLink.approved")}</Text> : null}
        {status === "pending" ? <Text>{t("parentLink.pending")}</Text> : null}
        {status === "approved" ? (
          <Button
            variant="secondary"
            label={t("parentLink.unlink")}
            loading={unlink.isPending}
            onPress={() => linkQ.data && unlink.mutate(linkQ.data.id)}
          />
        ) : (
          <>
            <Text weight="bold">{t("parentLink.phoneLabel")}</Text>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              placeholder="01xxxxxxxxx"
              style={{
                minHeight: 48,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: radius.lg,
                paddingHorizontal: space.md,
              }}
            />
            <Button
              label={t("parentLink.submit")}
              loading={request.isPending}
              disabled={!phone.trim()}
              onPress={() => {
                const normalized = normalizePhoneE164(phone);
                if (!isValidE164Phone(normalized) || !/^\+201[0125]\d{8}$/.test(normalized)) {
                  toast.show(t("parentLink.invalidPhone"));
                  return;
                }
                request.mutate(normalized);
              }}
            />
          </>
        )}
      </View>
    </Page>
  );
}
