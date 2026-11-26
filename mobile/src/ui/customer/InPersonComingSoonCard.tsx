import { useEffect, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { MapPinned } from "lucide-react-native";
import { governorateOptions, isEgyptGovernorateCode } from "@shared/geo/egyptGovernorates";
import { useRequestArea } from "@/lib/bookingQueries";
import { useMyProfile } from "@/lib/queries";
import { Button } from "../Button";
import { Text } from "../Text";
import { BottomSheetSelect } from "../provider/BottomSheetSelect";
import { colors, radius, space } from "../theme";

/**
 * At-home service not available where the customer is: say so plainly, take a
 * "tell me when you arrive" by governorate and service, and point to online
 * lessons, which are open across Egypt.
 */
export function InPersonComingSoonCard({
  serviceId,
  onShowOnline,
}: {
  serviceId?: string | null;
  onShowOnline?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const profile = useMyProfile();
  const saved = (profile.data as { governorate?: string | null } | null | undefined)?.governorate;
  const [governorate, setGovernorate] = useState("");
  const request = useRequestArea();

  useEffect(() => {
    if (!governorate && isEgyptGovernorateCode(saved)) setGovernorate(saved);
  }, [saved, governorate]);

  const message =
    request.error && typeof request.error === "object" && "message" in request.error
      ? String(request.error.message)
      : "";
  const limited = /area_request_rate_limited/.test(message);
  const [attempted, setAttempted] = useState(false);

  return (
    <View
      testID="in-person-coming-soon"
      style={{
        gap: space.md,
        padding: space.lg,
        borderRadius: radius.lg,
        backgroundColor: colors.brandTint,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <MapPinned size={20} color={colors.brand} accessible={false} />
        <Text weight="heavy">{t("onlineNationwide.inPersonSoonTitle")}</Text>
      </View>
      <Text size="sm" tone="muted">
        {t("onlineNationwide.inPersonSoonBody")}
      </Text>
      {request.isSuccess || limited ? (
        <Text size="sm" weight="bold" tone="brand">
          {t("onlineNationwide.notifyThanks")}
        </Text>
      ) : (
        <>
          <BottomSheetSelect
            label={t("onlineNationwide.governorate")}
            value={governorate}
            onChange={setGovernorate}
            options={governorateOptions(i18n.language)}
          />
          {attempted && !governorate ? (
            <Text size="sm" tone="danger">
              {t("onlineNationwide.pickGovernorateFirst")}
            </Text>
          ) : null}
          <Button
            variant="secondary"
            label={t("onlineNationwide.notifyMe")}
            loading={request.isPending}
            onPress={() => {
              setAttempted(true);
              if (!governorate) return;
              request.mutate({ governorate, serviceId: serviceId ?? null });
            }}
          />
        </>
      )}
      {request.isError && !limited ? (
        <Text size="sm" tone="danger">
          {t("common.somethingWentWrong")}
        </Text>
      ) : null}
      {onShowOnline ? (
        <Button label={t("onlineNationwide.showOnline")} onPress={onShowOnline} />
      ) : null}
    </View>
  );
}
