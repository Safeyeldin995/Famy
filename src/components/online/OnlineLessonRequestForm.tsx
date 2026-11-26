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
import { getBookingErrorMessage } from "@/lib/booking/errors";
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
import { useMyProfile } from "@/lib/db/queries";
import { useActiveFamilyMembers } from "@/lib/db/family-members-queries";
import { useCustomerEducationProfile } from "@/lib/db/student-education-queries";
import {
  MYSELF_LEARNER_ID,
  buildLearnerOptions,
  findLearner,
  initialLearnerId as pickInitialLearner,
  learnerFamilyMemberId,
  shouldAskForWhom,
} from "@/lib/tutoring/studentLearnerFlow";
import { chipClass } from "@/components/student/StudentProfileSteps";
import { memberAgeFromDate } from "@/lib/familyMemberAge";
import { ONLINE_PARENT_SUPERVISION_MODE } from "@/lib/online/onlineBookingLearnerAge";
import { Checkbox } from "@/components/ui/checkbox";

type Props = {
  providerId: string;
  /** «الحجز لمين؟» choice carried from the matched tutors list ("myself" or a child id). */
  initialLearnerId?: string;
  /** The matched capability (subject + system + grade, price and duration) to preselect. */
  initialCapabilityId?: string;
};

export function OnlineLessonRequestForm({
  providerId,
  initialLearnerId,
  initialCapabilityId,
}: Props) {
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
  const idempotencyKeyRef = useRef(crypto.randomUUID());
  const [parentPhone, setParentPhone] = useState("");
  const [parentEmail, setParentEmail] = useState("");
  const guardian = useOnlineStudentNeedsGuardianContact();
  const registerGuardian = useRegisterParentGuardianContact();
  const profileQ = useMyProfile();
  const membersQ = useActiveFamilyMembers();
  const educationQ = useCustomerEducationProfile();
  const learners = useMemo(
    () =>
      buildLearnerOptions({
        selfFullName: profileQ.data?.full_name,
        selfProfile: educationQ.data,
        children: (membersQ.data ?? []).map((m) => ({
          id: m.id,
          full_name: m.full_name,
          education_curriculum_id: m.education_curriculum_id,
          education_level_id: m.education_level_id,
        })),
      }),
    [profileQ.data?.full_name, educationQ.data, membersQ.data],
  );
  const [learnerId, setLearnerId] = useState<string>(initialLearnerId ?? MYSELF_LEARNER_ID);
  useEffect(() => {
    if (membersQ.isSuccess) setLearnerId((cur) => pickInitialLearner(learners, cur));
  }, [learners, membersQ.isSuccess]);
  const learner = findLearner(learners, learnerId);
  // The 12+ birth date and the under-18 parent contact belong to the student, i.e. the
  // account owner when booking for «أنا». A child's age is checked by the server from the child's record.
  const bookingForSelf = learnerId === MYSELF_LEARNER_ID;
  // A parent may book an online lesson for their own child under 12 once they confirm they will
  // be with the child or supervising (the server stores it as supervision_mode 'parent_online').
  const selectedChild = bookingForSelf
    ? null
    : (membersQ.data ?? []).find((m) => m.id === learnerId) ?? null;
  const childAge = selectedChild?.date_of_birth
    ? memberAgeFromDate(selectedChild.date_of_birth)
    : null;
  const childNeedsParentSupervision = Boolean(selectedChild && childAge && childAge.years < 12);
  const [parentSupervised, setParentSupervised] = useState(false);
  useEffect(() => {
    setParentSupervised(false);
  }, [learnerId]);
  const parentSupervisionMissing = childNeedsParentSupervision && !parentSupervised;

  const tutoringServices = useMemo(() => {
    const bookable = bookableQ.data;
    if (!bookable) return [];
    return (servicesQ.data ?? []).filter(
      (row: { service?: { id?: string; slug?: string; category?: { slug?: string } } }) => {
        const id = row.service?.id;
        return !!id && bookable.has(id) && isTutoringCategorySlug(row.service?.category?.slug);
      },
    );
  }, [bookableQ.data, servicesQ.data]);

  useEffect(() => {
    if (!tutoringServices.length) {
      setServiceId(null);
      return;
    }
    if (
      serviceId &&
      tutoringServices.some((row: { service?: { id?: string } }) => row.service?.id === serviceId)
    ) {
      return;
    }
    setServiceId(tutoringServices[0]?.service?.id ?? null);
    setCapabilityId(null);
    setSlotStart(null);
  }, [serviceId, tutoringServices]);

  const activeService = useMemo(
    () =>
      tutoringServices.find(
        (row: { service?: { id?: string } }) => row.service?.id === serviceId,
      ) ??
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

  // Coming from the matched list: switch to the capability's service and preselect it once.
  const appliedCapRef = useRef<string | null>(null);
  const capServiceQ = useApprovedTeachingCapabilities(providerId);
  useEffect(() => {
    if (!initialCapabilityId || appliedCapRef.current === initialCapabilityId) return;
    const cap = (capServiceQ.data ?? []).find((row) => row.id === initialCapabilityId);
    if (!cap) return;
    if (cap.serviceId !== resolvedServiceId) {
      setServiceId(cap.serviceId);
      return;
    }
    appliedCapRef.current = initialCapabilityId;
    setCapabilityPick({
      subjectCode: cap.subjectCode,
      curriculumId: cap.curriculumId,
      levelId: cap.levelId,
    });
    setCapabilityId(cap.id);
  }, [initialCapabilityId, capServiceQ.data, resolvedServiceId]);

  // Otherwise prefill the learner's saved system and grade (the parent still picks the subject).
  useEffect(() => {
    if (initialCapabilityId && appliedCapRef.current === initialCapabilityId) return;
    if (!learner?.curriculumId || !learner.levelId) return;
    setCapabilityPick((cur) =>
      cur.curriculumId || cur.levelId
        ? cur
        : {
            subjectCode: cur.subjectCode,
            curriculumId: learner.curriculumId ?? "",
            levelId: learner.levelId ?? "",
          },
    );
  }, [learner?.curriculumId, learner?.levelId, initialCapabilityId]);
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

  useEffect(() => {
    idempotencyKeyRef.current = crypto.randomUUID();
  }, [resolvedServiceId, capabilityId, slotStart?.toISOString()]);

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
        forWhom: learnerId,
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
        supervisionMode:
          childNeedsParentSupervision && parentSupervised ? ONLINE_PARENT_SUPERVISION_MODE : null,
      });
      const result = await create.mutateAsync({
        ...payload,
        family_member_id:
          learnerFamilyMemberId(learnerId) ?? bookingFamilyMemberId(MYSELF_LEARNER_ID),
        idempotency_key: idempotencyKeyRef.current,
      });
      toast.success(t("onlineWeb.request.success"));
      if (
        bookingForSelf &&
        guardian.isMinorStudent &&
        (guardian.needsNewContact || parentPhone.trim() || parentEmail.trim())
      ) {
        void tryRegisterGuardianContact();
      }
      nav({ to: onlineWebLessonPath(result.id), replace: true });
    } catch (error) {
      toast.error(getBookingErrorMessage(error, (key, fallback) => t(key, fallback ?? key)));
    }
  };

  const loading =
    servicesQ.isLoading ||
    bookableQ.isLoading ||
    capabilitiesQ.isLoading ||
    guardian.loading ||
    membersQ.isLoading;
  if (loading) {
    return <p className="text-pro-14 text-muted-foreground">{t("common.loading")}</p>;
  }
  if (!resolvedServiceId || tutoringServices.length === 0) {
    return <p className="text-pro-14 text-muted-foreground">{t("onlineWeb.request.noService")}</p>;
  }

  const form = (
    <div className="space-y-5">
      {shouldAskForWhom(learners) ? (
        <div className="space-y-2">
          <p className="text-pro-13 font-bold text-muted-foreground">
            {t("studentMatch.forWhomTitle")}
          </p>
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label={t("studentMatch.forWhomTitle")}
          >
            {learners.map((l) => (
              <button
                key={l.id}
                type="button"
                className={chipClass(l.id === learnerId)}
                aria-pressed={l.id === learnerId}
                onClick={() => {
                  setLearnerId(l.id);
                  setCapabilityPick({
                    subjectCode: "",
                    curriculumId: l.curriculumId ?? "",
                    levelId: l.levelId ?? "",
                  });
                  setCapabilityId(null);
                }}
              >
                {l.kind === "self" ? t("studentMatch.me") : l.firstName}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {childNeedsParentSupervision ? (
        <label className="flex items-start gap-3 rounded-2xl border border-border bg-muted/40 p-3 text-pro-14">
          <Checkbox
            checked={parentSupervised}
            onCheckedChange={(v) => setParentSupervised(v === true)}
            aria-label={t("onlineWeb.request.parentSupervision")}
            className="mt-0.5 h-5 w-5"
          />
          <span className="space-y-1">
            <span className="block font-bold text-foreground">
              {t("onlineWeb.request.parentSupervision")}
            </span>
            <span className="block text-pro-13 text-muted-foreground">
              {t("onlineWeb.request.parentSupervisionHint")}
            </span>
          </span>
        </label>
      ) : null}
      {bookingForSelf && guardian.isMinorStudent && guardian.needsNewContact ? (
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
          <span className="text-pro-13 font-bold text-muted-foreground">
            {t("bookingUx.chooseService")}
          </span>
          <select
            className="mt-2 w-full rounded-2xl border border-border bg-white p-3 text-pro-14"
            value={resolvedServiceId}
            onChange={(e) => {
              setServiceId(e.target.value);
              setCapabilityId(null);
            }}
          >
            {tutoringServices.map(
              (row: { service?: { id?: string; name_ar?: string; name_en?: string } }) => (
                <option key={row.service?.id} value={row.service?.id}>
                  {row.service?.name_ar || row.service?.name_en}
                </option>
              ),
            )}
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
        <p className="text-pro-13 font-bold text-muted-foreground">
          {t("onlineWeb.request.pickDay")}
        </p>
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
                {formatDate(
                  d,
                  { weekday: "short", day: "numeric", month: "short" },
                  locale,
                  ONLINE_WEB_TIME_ZONE,
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="text-pro-13 font-bold text-muted-foreground">
          {t("onlineWeb.request.pickTime")}
        </p>
        {!selectedCapability ? (
          <p className="mt-2 text-pro-13 text-muted-foreground">
            {t("customerBooking.sessionDuration")}
          </p>
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
        <span className="text-pro-13 font-bold text-muted-foreground">
          {t("onlineWeb.request.notes")}
        </span>
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
            {t("bookFlow.sessionLine", {
              minutes: formatNumber(selectedCapability.durationMin, lang),
            })}
            {selectedSlot
              ? ` · ${formatTime(selectedSlot.end, locale, ONLINE_WEB_TIME_ZONE)}`
              : null}
          </p>
          <p className="mt-2 text-pro-12 text-muted-foreground">
            {t("onlineWeb.cancelPolicy.body")}
          </p>
        </div>
      ) : null}

      <p className="text-pro-12 text-muted-foreground">{t("onlineWeb.timezoneLabel")}</p>

      <PrimaryButton
        className="h-12 w-full"
        disabled={!selectedSlot || !selectedCapability || create.isPending || parentSupervisionMissing}
        onClick={() => void submit()}
      >
        {t("onlineWeb.walkthrough.requestLesson")}
      </PrimaryButton>
    </div>
  );

  return bookingForSelf ? <OnlineWebCustomerDobGate>{form}</OnlineWebCustomerDobGate> : form;
}
