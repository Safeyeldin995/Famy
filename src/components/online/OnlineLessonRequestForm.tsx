import { useEffect, useMemo, useState } from "react";
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
import { useBillingSettings } from "@/lib/db/settings-queries";
import { onlineLessonRequestTotal } from "@/lib/online/onlineLessonRequestQuote";
import { bookingFamilyMemberId } from "@/lib/booking/babysittingRecipient";
import { onlineWebLessonPath } from "@/lib/web/onlineWebSurface";
import { OnlineWebCustomerDobGate } from "@/components/online/OnlineWebCustomerDobGate";
import {
  OnlineWebParentContactFields,
  useOnlineStudentNeedsGuardianContact,
} from "@/components/online/OnlineWebParentLinkGate";
import { useRegisterParentGuardianContact } from "@/lib/db/student-parent-link-queries";
import { sendParentGuardianEmailFn } from "@/lib/email/parentGuardianEmail.functions";
import { isTutoringCategorySlug } from "@/lib/tutoring/teachingCapabilities";
import {
  cairoDayStrip,
  cairoTodayStart,
  localMidnightForCairoInstant,
  sameCairoCalendarDay,
  ONLINE_WEB_TIME_ZONE,
} from "@/lib/online/onlineWebCairoTime";
import { formatEGP, formatDate, formatTime, formatLocale, formatNumber } from "@/lib/format";
import { currentLang } from "@/lib/i18n";
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
  const billingQ = useBillingSettings();
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [capabilityPick, setCapabilityPick] = useState<CapabilityPickValue>({
    subjectCode: "",
    curriculumId: "",
    levelId: "",
  });
  const [capabilityId, setCapabilityId] = useState<string | null>(null);
  const lang = currentLang();
  const locale = formatLocale(lang);
  const [day, setDay] = useState(() => cairoTodayStart());
  const [slotStart, setSlotStart] = useState<Date | null>(null);
  const [notes, setNotes] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [parentEmail, setParentEmail] = useState("");
  const guardian = useOnlineStudentNeedsGuardianContact();
  const registerGuardian = useRegisterParentGuardianContact();

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
  const slotsDay = useMemo(() => localMidnightForCairoInstant(day), [day]);

  const slotsQ = useAvailableSlots(providerId, slotsDay, slotMinutes || 60, {
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

  const dayOptions = useMemo(() => cairoDayStrip(14), []);

  const priceTotal = useMemo(() => {
    if (!selectedCapability || !billingQ.data) return null;
    return onlineLessonRequestTotal(
      { durationMin: selectedCapability.durationMin, price: selectedCapability.price },
      billingQ.data,
    );
  }, [billingQ.data, selectedCapability]);

  const selectedSlot = useMemo(() => {
    if (!slotStart) return null;
    return availableSlots.find((s) => s.start.getTime() === slotStart.getTime()) ?? null;
  }, [availableSlots, slotStart]);

  const tryRegisterGuardianContact = async () => {
    if (!guardian.isMinorStudent) return;
  const phone = parentPhone.trim();
    const email = parentEmail.trim();
    if (!phone || !email) {
      toast.info(t("studentParentLink.contactRetryHint"));
      return;
    }
    try {
      const registered = await registerGuardian.mutateAsync({
        parentPhone: phone,
        parentEmail: email,
      });
      const emailResult = await sendParentGuardianEmailFn({
        data: { linkId: String((registered as { link_id?: string }).link_id ?? "") || undefined },
      });
      if (emailResult?.ok === false) {
        toast.info(t("studentParentLink.contactRetryHint"));
      }
    } catch {
      toast.info(t("studentParentLink.contactRetryHint"));
    }
  };

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
        idempotency_key: crypto.randomUUID(),
      });
      toast.success(t("onlineWeb.request.success"));
      if (guardian.isMinorStudent && (guardian.needsNewContact || parentPhone.trim() || parentEmail.trim())) {
        void tryRegisterGuardianContact();
      }
      nav({ to: onlineWebLessonPath(result.id), replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.somethingWentWrong"));
    }
  };

  const loading = servicesQ.isLoading || bookableQ.isLoading || capabilitiesQ.isLoading || guardian.loading;
  if (loading) {
    return <p className="text-pro-14 text-muted-foreground">{t("common.loading")}</p>;
  }
  if (!resolvedServiceId || tutoringServices.length === 0) {
    return <p className="text-pro-14 text-muted-foreground">{t("onlineWeb.request.noService")}</p>;
  }

  return (
    <OnlineWebCustomerDobGate>
      <div className="space-y-5">
        {guardian.isMinorStudent && guardian.needsNewContact ? (
          <OnlineWebParentContactFields
            parentPhone={parentPhone}
            parentEmail={parentEmail}
            onParentPhoneChange={setParentPhone}
            onParentEmailChange={setParentEmail}
            disabled={registerGuardian.isPending || create.isPending}
          />
        ) : null}
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
              const active = sameCairoCalendarDay(d, day);
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
                  {formatDate(d, { weekday: "short", day: "numeric", month: "short" }, locale, ONLINE_WEB_TIME_ZONE)}
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

        {priceTotal != null && selectedCapability ? (
          <div className="rounded-2xl border border-border/60 bg-surface-2 p-4">
            <p className="text-pro-14 font-extrabold">
              {t("booking.total")}: {formatEGP(priceTotal, undefined, lang)}
            </p>
            <p className="mt-1 text-pro-13 text-muted-foreground">
              {t("bookFlow.sessionLine", { minutes: formatNumber(selectedCapability.durationMin, lang) })}
              {selectedSlot
                ? ` · ${formatTime(selectedSlot.end, locale, ONLINE_WEB_TIME_ZONE)}`
                : null}
            </p>
            <p className="mt-2 text-pro-12 text-muted-foreground">{t("onlineWeb.cancelPolicy.body")}</p>
          </div>
        ) : null}

        <p className="text-pro-12 text-muted-foreground">{t("onlineWeb.timezoneLabel")}</p>

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