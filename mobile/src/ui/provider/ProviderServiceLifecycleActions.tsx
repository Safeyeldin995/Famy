import { useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import {
  useRemoveProviderService,
  useSetProviderServiceActive,
} from "@/lib/provider/profileQueries";
import type { ProviderServiceRowStatus } from "@shared/provider/providerServiceGroups";
import { Button } from "../Button";
import { Confirm } from "../Page";
import { space } from "../theme";

type ConfirmKind = "pause" | "remove";

export function ProviderServiceLifecycleActions({
  providerId,
  serviceId,
  status,
  onSuccess,
  onError,
}: {
  providerId: string;
  serviceId: string;
  status: ProviderServiceRowStatus;
  onSuccess: (message: string) => void;
  onError: () => void;
}) {
  const { t } = useTranslation();
  const setActive = useSetProviderServiceActive(providerId);
  const remove = useRemoveProviderService(providerId);
  const [confirm, setConfirm] = useState<ConfirmKind | null>(null);
  const busy = setActive.isPending || remove.isPending;

  if (status !== "approved" && status !== "paused") return null;

  return (
    <View style={{ gap: space.sm, marginTop: space.sm }}>
      {confirm ? (
        <Confirm
          title={
            confirm === "pause"
              ? t("pro.serviceLifecycle.pauseTitle")
              : t("pro.serviceLifecycle.removeTitle")
          }
          body={
            confirm === "pause"
              ? t("pro.serviceLifecycle.pauseBody")
              : t("pro.serviceLifecycle.removeBody")
          }
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            if (confirm === "pause") {
              setActive.mutate(
                { serviceId, active: false },
                {
                  onSuccess: () => {
                    setConfirm(null);
                    onSuccess(t("pro.serviceLifecycle.paused"));
                  },
                  onError,
                },
              );
            } else {
              remove.mutate(serviceId, {
                onSuccess: (data) => {
                  setConfirm(null);
                  const count = data?.upcoming_bookings ?? 0;
                  onSuccess(
                    count > 0
                      ? t("pro.serviceLifecycle.removeUpcoming", { count })
                      : t("pro.serviceLifecycle.removed"),
                  );
                },
                onError,
              });
            }
          }}
        />
      ) : (
        <>
          {status === "approved" ? (
            <Button
              variant="secondary"
              label={t("pro.serviceLifecycle.pause")}
              disabled={busy}
              onPress={() => setConfirm("pause")}
            />
          ) : (
            <Button
              variant="secondary"
              label={t("pro.serviceLifecycle.resume")}
              loading={setActive.isPending}
              disabled={busy}
              onPress={() =>
                setActive.mutate(
                  { serviceId, active: true },
                  {
                    onSuccess: () => onSuccess(t("pro.serviceLifecycle.resumed")),
                    onError,
                  },
                )
              }
            />
          )}
          <Button
            variant="secondary"
            label={t("pro.serviceLifecycle.remove")}
            disabled={busy}
            onPress={() => setConfirm("remove")}
          />
        </>
      )}
    </View>
  );
}