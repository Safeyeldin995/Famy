import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { PrimaryButton } from "@/components/famio/ui";
import {
  useAvailableSlots,
  useBookableServiceIds,
  useCreateBooking,
  useProvider,
} from "@/lib/db/queries";
import { buildBookingRequest } from "@/lib/booking/bookingRequest";
import { bookingFamilyMemberId } from "@/lib/booking/babysittingRecipient";
import { onlineWebLessonPath } from "@/lib/web/onlineWebSurface";

type Props = {
  providerId: string;
};

export function OnlineLessonRequestForm({ providerId }: Props) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const providerQ = useProvider(providerId, undefined, "online");
  const servicesQ = useBookableServiceIds(providerId, "online");
  const create = useCreateBooking();
  const [day, setDay] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [slotStart, setSlotStart] = useState<Date | null>(null);
  const [notes, setNotes] = useState("");

  const serviceId = useMemo(() => {
    const map = servicesQ.data;
    if (!map || map.size === 0) return null;
    return [...map.keys()][0] ?? null;
  }, [servicesQ.data]);
  const slotMinutes = 60;
  const slotsQ = useAvailableSlots(providerId, day, slotMinutes, {
    serviceId,
    addressId: null,
    cairoTime: true,
  });
  const availableSlots = useMemo(
    () => (slotsQ.data ?? []).filter((s) => s.available !== false),
    [slotsQ.data],
  );

  const dayOptions = useMemo(() => {
    const out: Date[] = [];
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    for (let i = 0; i < 14; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      out.push(d);
    }
    return out;
  }, []);

  const selectedSlot = useMemo(() => {
    if (!slotStart) return null;
    return availableSlots.find((s) => s.start.getTime() === slotStart.getTime()) ?? null;
  }, [availableSlots, slotStart]);

  const submit = async () => {
    if (!serviceId || !selectedSlot || create.isPending) return;
    try {
      const payload = buildBookingRequest({
        providerId,
        serviceId,
        addressId: null,
        serviceMode: "online",
        forWhom: "myself",
        start: selectedSlot.start,
        end: selectedSlot.end,
        promoStatus: "none",
        appliedPromoId: null,
        notes: notes.trim(),
        eitherRequirements: [],
        requirementChoices: {},
        selectedCapability: null,
        supervisionMode: null,
      });
      const result = await create.mutateAsync({
        ...payload,
        family_member_id: bookingFamilyMemberId("myself"),
        idempotency_key: crypto.randomUUID(),
      });
      toast.success(t("onlineWeb.request.success"));
      nav({ to: onlineWebLessonPath(result.id), replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.somethingWentWrong"));
    }
  };

  if (providerQ.isLoading || servicesQ.isLoading) {
    return <p className="text-pro-14 text-muted-foreground">{t("common.loading")}</p>;
  }
  if (!serviceId) {
    return <p className="text-pro-14 text-muted-foreground">{t("onlineWeb.request.noService")}</p>;
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-pro-13 font-bold text-muted-foreground">{t("onlineWeb.request.pickDay")}</p>
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {dayOptions.map((d) => {
            const active = d.toDateString() === day.toDateString();
            return (
              <button
                key={d.toISOString()}
                type="button"
                className={`shrink-0 rounded-2xl border px-3 py-2 text-pro-13 font-bold ${
                  active ? "border-brand bg-brand/10 text-brand" : "border-border bg-white"
                }`}
                onClick={() => {
                  setDay(d);
                  setSlotStart(null);
                }}
              >
                {d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="text-pro-13 font-bold text-muted-foreground">{t("onlineWeb.request.pickTime")}</p>
        {slotsQ.isLoading ? (
          <p className="mt-2 text-pro-13 text-muted-foreground">{t("common.loading")}</p>
        ) : availableSlots.length === 0 ? (
          <p className="mt-2 text-pro-13 text-muted-foreground">{t("onlineWeb.request.noSlots")}</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {availableSlots.map((s) => {
              const active = slotStart?.getTime() === s.start.getTime();
              return (
                <button
                  key={s.start.toISOString()}
                  type="button"
                  className={`rounded-2xl border px-3 py-2 text-pro-13 font-bold ${
                    active ? "border-brand bg-brand/10 text-brand" : "border-border bg-white"
                  }`}
                  onClick={() => setSlotStart(s.start)}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <label className="block">
        <span className="text-pro-13 font-bold text-muted-foreground">{t("onlineWeb.request.notes")}</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="mt-2 min-h-24 w-full rounded-2xl border border-border bg-white p-3 text-pro-14"
          placeholder={t("onlineWeb.request.notesPlaceholder")}
        />
      </label>

      <PrimaryButton
        className="h-12 w-full"
        disabled={!selectedSlot || create.isPending}
        onClick={() => void submit()}
      >
        {t("onlineWeb.walkthrough.requestLesson")}
      </PrimaryButton>
    </div>
  );
}