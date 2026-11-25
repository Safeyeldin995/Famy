import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { PrimaryButton } from "@/components/famio/ui";
import { TutoringCapabilityCascadeFields } from "@/components/booking/TutoringCapabilityCascadeFields";
import {
  useAvailableSlots,
  useBookableServiceIds,
  useCreateBooking,
  useProviderServices,
} from "@/lib/db/queries";
import { useApprovedTeachingCapabilities } from "@/lib/db/teaching-queries";
import { buildBookingRequest } from "@/lib/booking/bookingRequest";
import { bookingFamilyMemberId } from "@/lib/booking/babysittingRecipient";
import { onlineWebLessonPath } from "@/lib/web/onlineWebSurface";
import { OnlineWebCustomerDobGate } from "@/components/online/OnlineWebCustomerDobGate";
import { isTutoringCategorySlug } from "@/lib/tutoring/teachingCapabilities";
import { getBookingErrorMessage } from "@/lib/booking/errors";
import type { CapabilityPickValue } from "@/lib/tutoring/providerCapabilityCascade";
import type { TeachingCapabilityOption } from "@/lib/tutoring/teachingCapabilities";

type Props = {
  providerId: string;
};

export function OnlineLessonRequestForm({ providerId }: Props) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const servicesQ = useProviderServices(providerId);
  const bookableQ = useBookableServiceIds(providerId, undefined, "online");
  const create = useCreateBooking();
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [capabilityPick, setCapabilityPick] = useState<CapabilityPickValue>({
    subjectCode: "",
    curriculumId: "",
    levelId: "",
  });
  const [capabilityId, setCapabilityId] = useState<string | null>(null);
  const [day, setDay] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [slotStart, setSlotStart] = useState<Date | null>(null);
  const [notes, setNotes] = useState("");
  const idempotencyKeyRef = useRef(crypto.randomUUID());

  const tutoringServices = useMemo(() => {
    const bookable = bookableQ.data;
    if (!bookable) return [];
    return (servicesQ.data ?? []).filter((row: { service?: { id?: string; slug?: string; category?: { slug?: string } } }) => {
      const id = row.service?.id;
      return (
        !!id &&
        bookable.has(id) &&
        isTutoringCategorySlug(row.service?.category?.slug)
      );
    });
  }, [bookableQ.data, servicesQ.data]);

  useEffect(() => {
    if (!tutoringServices.length) {
      setServiceId(null);
      return;
    }
    if (serviceId && tutoringServices.some((row: { service?: { id?: string } }) => row.service?.id === serviceId)) {
      return;
    }
    setServiceId(tutoringServices[0]?.service?.id ?? null);
    setCapabilityId(null);
    setSlotStart(null);
  }, [serviceId, tutoringServices]);

  const activeService = useMemo(
    () =>
      tutoringServices.find((row: { service?: { id?: string } }) => row.service?.id === serviceId) ??
      tutoringServices[0] ??
      null,
    [serviceId, tutoringServices],
  );
  const resolvedServiceId = activeService?.service?.id ?? null;
  const serviceSlug = activeService?.service?.slug ?? null;

  const capabilitiesQ = useApprovedTeachingCapabilities(providerId, resolvedServiceId ?? undefined);
  const capabilities = capabilitiesQ.data ?? [];
  const selectedCapability: TeachingCapabilityOption | null =
    capabilities.find((row) => row.id === capabilityId) ?? null;
  const slotMinutes = selectedCapability?.durationMin ?? 0;

  const slotsQ = useAvailableSlots(providerId, day, slotMinutes || 60, {
    serviceId: resolvedServiceId,
    addressId: null,
    serviceMode: "online",
    cairoTime: true,
  });
  const availableSlots = useMemo(
    () => (slotsQ.data ?? []).filter((s) => s.available !== false),
    [slotsQ.data],
  );

  useEffect(() => {
    setSlotStart(null);
  }, [capabilityId, day]);

  useEffect(() => {
    idempotencyKeyRef.current = crypto.randomUUID();
  }, [resolvedServiceId, capabilityId, slotStart?.toISOString()]);

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
    if (!resolvedServiceId || !selectedSlot || !selectedCapability || create.isPending) return;
    try {
      const payload = buildBookingRequest({
        providerId,
        serviceId: resolvedServiceId,
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
        selectedCapability: {
          id: selectedCapability.id,
          subjectCode: selectedCapability.subjectCode,
          curriculumCode: selectedCapability.curriculumCode,
          levelCode: selectedCapability.levelCode,
        },
        supervisionMode: null,
      });
      const result = await create.mutateAsync({
        ...payload,
        family_member_id: bookingFamilyMemberId("myself"),
        idempotency_key: idempotencyKeyRef.current,
      });
      toast.success(t("onlineWeb.request.success"));
      nav({ to: onlineWebLessonPath(result.id), replace: true });
    } catch (error) {
      toast.error(getBookingErrorMessage(error, (key, fallback) => t(key, fallback ?? key)));
    }
  };

  const loading = servicesQ.isLoading || bookableQ.isLoading || capabilitiesQ.isLoading;
  if (loading) {
    return <p className="text-pro-14 text-muted-foreground">{t("common.loading")}</p>;
  }
  if (!resolvedServiceId || tutoringServices.length === 0) {
    return <p className="text-pro-14 text-muted-foreground">{t("onlineWeb.request.noService")}</p>;
  }

  return (
    <OnlineWebCustomerDobGate>
      <div className="space-y-5">
        {tutoringServices.length > 1 ? (
          <label className="block">
            <span className="text-pro-13 font-bold text-muted-foreground">{t("bookingUx.chooseService")}</span>
            <select
              className="mt-2 w-full rounded-2xl border border-border bg-white p-3 text-pro-14"
              value={resolvedServiceId}
              onChange={(e) => {
                setServiceId(e.target.value);
                setCapabilityId(null);
              }}
            >
              {tutoringServices.map((row: { service?: { id?: string; name_ar?: string; name_en?: string } }) => (
                <option key={row.service?.id} value={row.service?.id}>
                  {row.service?.name_ar || row.service?.name_en}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <TutoringCapabilityCascadeFields
          serviceId={resolvedServiceId}
          serviceSlug={serviceSlug}
          capabilities={capabilities}
          pick={capabilityPick}
          capabilityId={capabilityId}
          onPickChange={setCapabilityPick}
          onCapabilityChange={setCapabilityId}
        />

        <div>
          <p className="text-pro-13 font-bold text-muted-foreground">{t("onlineWeb.request.pickDay")}</p>
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {dayOptions.map((d) => {
              const active = d.toDateString() === day.toDateString();
              return (
                <button
                  key={d.toISOString()}
                  type="button"
                  disabled={!selectedCapability}
                  className={`shrink-0 rounded-2xl border px-3 py-2 text-pro-13 font-bold ${
                    active ? "border-brand bg-brand/10 text-brand" : "border-border bg-white"
                  }`}
                  onClick={() => setDay(d)}
                >
                  {d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="text-pro-13 font-bold text-muted-foreground">{t("onlineWeb.request.pickTime")}</p>
          {!selectedCapability ? (
            <p className="mt-2 text-pro-13 text-muted-foreground">{t("customerBooking.sessionDuration")}</p>
          ) : slotsQ.isLoading ? (
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
          disabled={!selectedSlot || !selectedCapability || create.isPending}
          onClick={() => void submit()}
        >
          {t("onlineWeb.walkthrough.requestLesson")}
        </PrimaryButton>
      </div>
    </OnlineWebCustomerDobGate>
  );
}