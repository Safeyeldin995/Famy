import { useEffect, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { hasSharedWorkingHours, type WorkingRule } from "@/lib/provider/availabilityHelpers";
import {
  useMyProvider,
  useProviderAvailability,
  useReplaceAvailability,
  useUpdateProvider,
} from "@/lib/provider/queries";
import { WeeklyHoursEditor } from "@/ui/provider/WeeklyHoursEditor";
import { proCard } from "@/ui/provider/cards";
import { Page, QueryState, ActionError } from "@/ui/Page";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { space } from "@/ui/theme";

export default function ProviderSchedule() {
  const { t } = useTranslation();
  const p = useMyProvider();
  const provider = p.data as Record<string, unknown> | null | undefined;
  const availQ = useProviderAvailability(provider?.id as string | undefined);
  const save = useReplaceAvailability();
  const updateProv = useUpdateProvider();
  const [rows, setRows] = useState<WorkingRule[]>([]);
  const [sameHours, setSameHours] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!availQ.data?.length) return;
    const loaded = Array.from({ length: 7 }, (_, weekday) =>
      availQ.data.find((row) => row.weekday === weekday),
    )
      .filter(Boolean)
      .map((row) => ({
        weekday: row!.weekday,
        start_time: String(row!.start_time).slice(0, 5),
        end_time: String(row!.end_time).slice(0, 5),
      }));
    setRows(loaded);
    setSameHours(hasSharedWorkingHours(availQ.data as WorkingRule[]));
  }, [availQ.data]);

  const handleSave = () => {
    if (!provider?.id) return;
    setSaved(false);
    save.mutate(
      {
        providerId: String(provider.id),
        rules: rows.map((r) => ({
          weekday: r.weekday,
          start_time: r.start_time,
          end_time: r.end_time,
        })),
      },
      { onSuccess: () => setSaved(true) },
    );
  };

  const vacation = !!provider?.vacation_mode;

  return (
    <Page tab title={t("pro.schedule.title")} queries={[p, availQ]}>
      <QueryState query={availQ}>
        <View style={proCard.card}>
          <Text weight="heavy">{t("scheduleUi.hours")}</Text>
          <WeeklyHoursEditor
            value={rows}
            onChange={setRows}
            sameHours={sameHours}
            onSameHoursChange={setSameHours}
          />
        </View>
      </QueryState>
      <Button
        label={t(save.isPending ? "pro.common.saving" : "pro.schedule.saveSchedule")}
        loading={save.isPending}
        onPress={handleSave}
      />
      {save.isError ? <ActionError error={save.error} /> : null}
      {saved && !save.isError ? (
        <Text tone="brand" weight="bold">
          {t("pro.common.saved")}
        </Text>
      ) : null}
      <View style={[proCard.card, { marginTop: space.lg }]}>
        <Button
          variant="secondary"
          label={`${t("scheduleUi.vacation")}: ${t(vacation ? "scheduleUi.on" : "scheduleUi.off")}`}
          loading={updateProv.isPending}
          onPress={() => updateProv.mutate({ vacation_mode: !vacation })}
        />
        <Text tone="muted" size="sm">
          {t("pro.schedule.vacationSub")}
        </Text>
      </View>
    </Page>
  );
}
