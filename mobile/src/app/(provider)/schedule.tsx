import { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react-native";
import { hasSharedWorkingHours, type WorkingRule } from "@/lib/provider/availabilityHelpers";
import {
  useMyProvider,
  useProviderAvailability,
  useReplaceAvailability,
  useUpdateProvider,
  useProviderVacations,
  useAddVacation,
  useDeleteVacation,
  useProviderExceptions,
  useAddException,
  useDeleteException,
} from "@/lib/provider/queries";
import { WeeklyHoursEditor } from "@/ui/provider/WeeklyHoursEditor";
import { ScheduleDateSheet } from "@/ui/provider/ScheduleDateSheet";
import { proCard } from "@/ui/provider/cards";
import { Page, QueryState, ActionError } from "@/ui/Page";
import { ProviderHeader } from "@/ui/provider/ProviderHeader";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { colors, space } from "@/ui/theme";
import { customerNumber } from "@/lib/customerFormat";

const NOTICE_HOURS = [0, 1, 2, 3, 6, 12, 24] as const;
const BUFFER_MINUTES = [0, 15, 30, 60] as const;

function RuleChipRow({
  values,
  selected,
  unitKey,
  disabled,
  onSelect,
}: {
  values: readonly number[];
  selected: number;
  unitKey: "hoursUnit" | "minutes";
  disabled?: boolean;
  onSelect: (value: number) => void;
}) {
  const { t, i18n } = useTranslation();
  return (
    <ScrollView
      horizontal
      style={{ flexGrow: 0 }}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ flexDirection: "row", gap: 8, paddingVertical: 4 }}
    >
      {values.map((value) => {
        const active = selected === value;
        const label = `${customerNumber(value, i18n.language)} ${t(`scheduleUi.${unitKey}`)}`;
        return (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected: active, disabled }}
            disabled={disabled}
            onPress={() => onSelect(value)}
            style={{
              minHeight: 44,
              paddingHorizontal: 14,
              borderRadius: 999,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: active ? colors.brand : colors.border,
              backgroundColor: active ? colors.brandTint : colors.surface2,
              opacity: disabled ? 0.5 : 1,
            }}
          >
            <Text weight="bold" tone={active ? "brand" : "default"}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export default function ProviderSchedule() {
  const { t, i18n } = useTranslation();
  const p = useMyProvider();
  const provider = p.data as Record<string, unknown> | null | undefined;
  const availQ = useProviderAvailability(provider?.id as string | undefined);
  const save = useReplaceAvailability();
  const updateProv = useUpdateProvider();
  const providerId = provider?.id as string | undefined;
  const vacations = useProviderVacations(providerId);
  const exceptions = useProviderExceptions(providerId);
  const addVacation = useAddVacation();
  const deleteVacation = useDeleteVacation();
  const addException = useAddException();
  const deleteException = useDeleteException();
  const deleteBusy = deleteVacation.isPending || deleteException.isPending;
  const [dateSheet, setDateSheet] = useState<"vacation" | "holiday" | null>(null);
  const [rules, setRules] = useState({
    buffer_minutes: 30,
    min_notice_hours: 4,
    max_advance_days: 60,
  });
  const [rows, setRows] = useState<WorkingRule[]>([]);
  const [sameHours, setSameHours] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!availQ.data) return;
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

  useEffect(() => {
    if (!provider) return;
    setRules({
      buffer_minutes: Number(provider.buffer_minutes ?? 30),
      min_notice_hours: Number(provider.min_notice_hours ?? 4),
      max_advance_days: Number(provider.max_advance_days ?? 60),
    });
  }, [
    provider?.id,
    provider?.buffer_minutes,
    provider?.min_notice_hours,
    provider?.max_advance_days,
  ]);

  const handleSave = () => {
    if (!provider?.id || availQ.isPending || availQ.isError || save.isPending) return;
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
  const rulesBusy = updateProv.isPending || !provider?.id;
  const persistRules = (patch: Partial<typeof rules>) => {
    const next = { ...rules, ...patch };
    setRules(next);
    if (!provider?.id || updateProv.isPending) return;
    updateProv.mutate(next);
  };
  const dateLabel = (value: string, weekday = false) => {
    const [year, month, day] = value.split("-").map(Number);
    return new Intl.DateTimeFormat(i18n.language.startsWith("ar") ? "ar-EG-u-nu-latn" : "en-GB", {
      timeZone: "UTC",
      day: "numeric",
      month: "long",
      ...(weekday ? { weekday: "long" as const } : {}),
    }).format(new Date(Date.UTC(year, month - 1, day)));
  };

  return (
    <Page
      title={t("pro.schedule.title")}
      header={<ProviderHeader title={t("pro.schedule.title")} />}
      queries={[p, availQ, vacations, exceptions]}
    >
      <QueryState query={availQ}>
        <View style={proCard.card}>
          <Text weight="heavy">{t("scheduleUi.hours")}</Text>
          <WeeklyHoursEditor
            value={rows}
            onChange={setRows}
            sameHours={sameHours}
            onSameHoursChange={setSameHours}
            disabled={availQ.isPending || availQ.isError || save.isPending}
          />
        </View>
      </QueryState>
      <Button
        label={t(save.isPending ? "pro.common.saving" : "pro.schedule.saveSchedule")}
        loading={save.isPending}
        disabled={!provider?.id || availQ.isPending || availQ.isError}
        onPress={handleSave}
      />
      {save.isError ? <ActionError error={save.error} /> : null}
      {saved && !save.isError ? (
        <Text tone="brand" weight="bold">
          {t("pro.common.saved")}
        </Text>
      ) : null}
      <View style={[proCard.card, { gap: 16 }]}>
        <View style={{ gap: 8 }}>
          <Text weight="heavy">{t("pro.schedule.minNoticeQuestion")}</Text>
          <Text size="xs" tone="muted">
            {t("pro.schedule.minNoticeHelper")}
          </Text>
          <RuleChipRow
            values={NOTICE_HOURS}
            selected={rules.min_notice_hours}
            unitKey="hoursUnit"
            disabled={rulesBusy}
            onSelect={(min_notice_hours) => persistRules({ min_notice_hours })}
          />
        </View>
        <View style={{ gap: 8 }}>
          <Text weight="heavy">{t("pro.schedule.bufferQuestion")}</Text>
          <Text size="xs" tone="muted">
            {t("pro.schedule.bufferHelper")}
          </Text>
          <RuleChipRow
            values={BUFFER_MINUTES}
            selected={rules.buffer_minutes}
            unitKey="minutes"
            disabled={rulesBusy}
            onSelect={(buffer_minutes) => persistRules({ buffer_minutes })}
          />
        </View>
      </View>
      <View style={[proCard.card, { marginTop: space.lg }]}>
        <Pressable
          accessibilityRole="switch"
          accessibilityLabel={t("pro.schedule.vacationMode")}
          accessibilityState={{ checked: vacation, disabled: updateProv.isPending }}
          onPress={() => updateProv.mutate({ vacation_mode: !vacation })}
          disabled={updateProv.isPending}
          style={{
            minHeight: 44,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Text weight="bold">{t("scheduleUi.vacation")}</Text>
          <Text
            weight="bold"
            tone={vacation ? "brand" : "muted"}
            style={{
              backgroundColor: vacation ? colors.brandTint : colors.surface2,
              borderRadius: 999,
              paddingHorizontal: 12,
              paddingVertical: 8,
            }}
          >
            {t(vacation ? "scheduleUi.on" : "scheduleUi.off")}
          </Text>
        </Pressable>
        <Text tone="muted" size="sm">
          {t("pro.schedule.vacationSub")}
        </Text>
      </View>
      {(["vacation", "holiday"] as const).map((kind) => {
        const query = kind === "vacation" ? vacations : exceptions;
        const items = query.data ?? [];
        return (
          <View key={kind} style={{ gap: space.sm }}>
            <View
              style={{
                minHeight: 44,
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Text weight="heavy">
                {t(kind === "vacation" ? "scheduleUi.vacations" : "scheduleUi.holidays")}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("scheduleUi.add")}
                onPress={() => setDateSheet(kind)}
                style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 12 }}
              >
                <Text weight="bold" tone="brand">
                  {t("scheduleUi.add")}
                </Text>
              </Pressable>
            </View>
            <QueryState query={query}>
              <View style={[proCard.card, { paddingVertical: 0 }]}>
                {items.map((item) => (
                  <View
                    key={item.id}
                    style={{
                      minHeight: 64,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: space.sm,
                      borderBottomWidth: 1,
                      borderBottomColor: colors.border,
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text weight="bold" size="sm">
                        {"start_date" in item
                          ? t("scheduleUi.dateRange", {
                              start: dateLabel(item.start_date),
                              end: dateLabel(item.end_date),
                            })
                          : dateLabel(item.date, true)}
                      </Text>
                      {item.reason ? (
                        <Text tone="muted" size="xs">
                          {item.reason}
                        </Text>
                      ) : null}
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("common.delete")}
                      disabled={deleteBusy}
                      onPress={() =>
                        kind === "vacation"
                          ? deleteVacation.mutate({ id: item.id, providerId: providerId! })
                          : deleteException.mutate({ id: item.id, providerId: providerId! })
                      }
                      style={{
                        width: 44,
                        height: 44,
                        alignItems: "center",
                        justifyContent: "center",
                        opacity: deleteBusy ? 0.4 : 1,
                      }}
                    >
                      <Trash2 size={18} color={colors.muted} />
                    </Pressable>
                  </View>
                ))}
              </View>
            </QueryState>
          </View>
        );
      })}
      <ActionError
        error={
          updateProv.error ||
          addVacation.error ||
          addException.error ||
          deleteVacation.error ||
          deleteException.error
        }
      />
      {dateSheet ? (
        <ScheduleDateSheet
          range={dateSheet === "vacation"}
          busy={dateSheet === "vacation" ? addVacation.isPending : addException.isPending}
          error={dateSheet === "vacation" ? addVacation.isError : addException.isError}
          onClose={() => setDateSheet(null)}
          onSave={(start, end, reason) => {
            if (!providerId) return;
            if (dateSheet === "vacation")
              addVacation.mutate(
                { providerId, start_date: start, end_date: end, reason },
                { onSuccess: () => setDateSheet(null) },
              );
            else
              addException.mutate(
                { providerId, date: start, reason },
                { onSuccess: () => setDateSheet(null) },
              );
          }}
        />
      ) : null}
    </Page>
  );
}
