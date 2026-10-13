import { bookingWhenValues } from "@/lib/booking/bookingLabels";
import { ProfileAvatar } from "@/components/provider/ProfileAvatar";
import { applyServiceSubtitle } from "@/lib/provider/applyServiceSubtitle";
import { buildBookingRequest, buildBookingQuote } from "@/lib/booking/bookingRequest";
import { paymentPresentation } from "@/lib/booking/paymentPresentation";
import { bookingDisabledReason } from "@/lib/booking/disabledReason";
import { BOOKING_SCREENS, bookingScreenMissingStep, bookingScreenForStep, nextBookingScreen, groupBookingSubjects, type BookingScreen } from "@/lib/booking/bookingScreens";
import { StepHeader } from "@/components/famio/StepHeader";
import { StickyCta } from "@/components/famio/StickyCta";
import { ServiceCard } from "@/components/famio/ServiceCard";
import { NumberStepper } from "@/components/famio/NumberStepper";
import { CheckChip } from "@/components/famio/CheckChip";
import { TextField } from "@/components/famio/TextField";
import { BookingWhen } from "@/components/booking/BookingWhen";
import { BookingDetailsSheet } from "@/components/booking/BookingDetailsSheet";
import "@/components/booking/customerBooking.css";
import { isFixedPackage, filterFixedStartSlots, packageLabel } from "@/lib/pricing/servicePackages";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { PhoneFrame, Card, EmptyState } from "@/components/famio/ui";
import { QueryError } from "@/components/famio/QueryError";
import {
  useProvider,
  useProviderServices,
  useBookableServiceIds,
  useFixedPackageRate,
  useCreateBooking,
  useAddresses,
  useAvailableSlots,
  useResolveZone,
  useProviderBookingSettings,
  useMyProfile,
} from "@/lib/db/queries";
import { useActiveFamilyMembers } from "@/lib/db/family-members-queries";
import { validatePromoCode } from "@/lib/db/promo-codes-queries";
import { useCreatePayment, mapPaymentInsertError } from "@/lib/db/payment-queries";
import { redirectToPaymobCheckout } from "@/lib/paymob/paymobRedirect";
import { useProviderOnlyCustomerRedirect } from "@/lib/auth/providerOnlyCustomerGuard";
import { useActivePaymentMethods } from "@/lib/db/payment-methods-queries";
import { useRequirementsForService } from "@/lib/db/provider-queries";
import { toUIProvider } from "@/lib/db/adapters";
import { currentLang } from "@/lib/i18n";
import {
  MapPin,
  Banknote,
  Check,
  Loader2,
  Home,
  Briefcase,
  Users,
  Plus,
  Copy,
  Wallet,
  X,
  Clock,
  BookOpen,
  Sun,
  UserRound,
  Star,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatEGP, formatNumber } from "@/lib/format";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBillingSettings, DEFAULT_BILLING_SETTINGS } from "@/lib/db/settings-queries";
import {
  BookingError,
  getBookingErrorMessage,
  isSlotStaleBookingError,
} from "@/lib/booking/errors";
import {
  bookingSubmissionFingerprint,
  resolveIdempotencyKey,
  type IdempotencyKeyState,
} from "@/lib/booking/idempotency";
import { planPostCreatePayment, stashPendingPayment } from "@/lib/booking/post-create-payment";
import { previewPath } from "@/lib/preview/previewPath";
import {
  canContinueForWhom,
  defaultForWhom,
  familyMemberSelectableForBabysitting,
  isBabysittingCategorySlug,
  showMyselfOption,
} from "@/lib/booking/babysittingRecipient";
import { isClosedBetaCategorySlug } from "@/lib/catalog/closedBetaCategories";
import { useApprovedTeachingCapabilities } from "@/lib/db/teaching-queries";
import {
  isTutoringCategorySlug,
} from "@/lib/tutoring/teachingCapabilities";
import { markCustomerPushPromptPending } from "@/lib/push-prompt";
import {
  EducationProfileFields,
  educationValueFromIds,
  type EducationProfileValue,
} from "@/components/famio/EducationProfileFields";
import {
  useCustomerEducationProfile,
  useSaveStudentEducationProfile,
} from "@/lib/db/student-education-queries";
import { resolveStudentEducationProfile } from "@/lib/tutoring/studentEducationProfile";
import {
  pickDefaultCapabilityForEducation,
  persistEducationProfileAfterBooking,
  resolveAutoFillCapabilityId,
  shouldPersistEducationAfterBookingSuccess,
} from "@/lib/tutoring/bookingEducationAutofill";

export const Route = createFileRoute("/book/$providerId")({
  validateSearch: (search: Record<string, unknown>) => ({
    serviceId: typeof search.serviceId === "string" ? search.serviceId : undefined,
    capabilityId: typeof search.capabilityId === "string" ? search.capabilityId : undefined,
  }),
  component: Book,
});

function Book() {
  const { blocking } = useProviderOnlyCustomerRedirect();
  const { providerId } = Route.useParams();
  const { serviceId: searchServiceId, capabilityId: searchCapabilityId } = Route.useSearch();
  if (blocking) return null;
  return (
    <BookContent
      providerId={providerId}
      searchServiceId={searchServiceId}
      searchCapabilityId={searchCapabilityId}
    />
  );
}

export function BookContent({
  providerId,
  searchServiceId,
  searchCapabilityId,
}: {
  providerId: string;
  searchServiceId?: string;
  searchCapabilityId?: string;
}) {
  const provQ = useProvider(providerId);
  const servicesQ = useProviderServices(providerId);
  const addrsQ = useAddresses();
  const familyMembersQ = useActiveFamilyMembers();
  const createBooking = useCreateBooking();
  const createPayment = useCreatePayment();
  const methodsQ = useActivePaymentMethods();
  const billingQ = useBillingSettings();
  const { t } = useTranslation();
  const nav = useNavigate();

  const [requestedStep, setRequestedStep] = useState<BookingScreen>("service");
  const [serviceId, setServiceId] = useState<string | null>(searchServiceId ?? null);
  const [capabilityId, setCapabilityId] = useState<string | null>(searchCapabilityId ?? null);
  const [duration, setDuration] = useState("4h");
  const [date, setDate] = useState<Date | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<{ start: Date; end: Date } | null>(null);
  const [address, setAddress] = useState("");
  const [addressId, setAddressId] = useState<string | null>(null);
  const [forWhom, setForWhom] = useState("myself");
  const [notes, setNotes] = useState("");
  const [paymentMethodId, setPaymentMethodId] = useState<string | null>(null);
  const [promoCode, setPromoCode] = useState("");
  const [promoStatus, setPromoStatus] = useState<"idle" | "checking" | "applied" | "invalid">(
    "idle",
  );
  const [promoDiscount, setPromoDiscount] = useState(0);
  const [appliedPromoId, setAppliedPromoId] = useState<string | null>(null);
  const [requirementChoices, setRequirementChoices] = useState<
    Record<string, "customer" | "provider">
  >({});
  const [editingReview, setEditingReview] = useState(false);
  const [detailsSheet, setDetailsSheet] = useState<"address" | "member" | null>(null);
  const [inlineError, setInlineError] = useState<{ screen: BookingScreen; message: string } | null>(null);
  const [scanningSchedule, setScanningSchedule] = useState(false);
  const [bookingEducation, setBookingEducation] = useState<EducationProfileValue>(
    educationValueFromIds(null, null),
  );
  const [saveEducationForNextTime, setSaveEducationForNextTime] = useState(false);
  const userPickedDateRef = useRef(false);
  const userPickedCapabilityRef = useRef(false);
  const idempotencyStateRef = useRef<IdempotencyKeyState | null>(null);
  const customerEducationQ = useCustomerEducationProfile();
  const myProfileQ = useMyProfile();
  const saveEducation = useSaveStudentEducationProfile();

  // Only addresses with a pinned location can back a real booking — the
  // server enforces this too (booking_locations snapshot trigger rejects a
  // NULL lat/lng), this just keeps the picker from offering a dead end.
  const bookableAddresses = (addrsQ.data ?? []).filter((a: any) => a.lat != null && a.lng != null);
  const defaultBookableAddressId =
    bookableAddresses.find((a: any) => a.is_default)?.id ?? bookableAddresses[0]?.id;
  const slotAddressId = addressId ?? defaultBookableAddressId ?? null;
  // Only services the provider can actually be booked for (same eligibility
  // the booking trigger enforces), so the customer never picks a service that
  // fails later with PROVIDER_INELIGIBLE (e.g. subjects still under review).
  const bookableQ = useBookableServiceIds(providerId, slotAddressId ?? undefined);
  const services = useMemo(
    () =>
      (servicesQ.data ?? []).filter(
        (row: { service?: { id?: string; category?: { slug?: string } } }) =>
          isClosedBetaCategorySlug(row.service?.category?.slug) &&
          (!bookableQ.data || bookableQ.data.has(row.service?.id ?? "")),
      ),
    [servicesQ.data, bookableQ.data],
  );
  const eligibilityServiceId =
    (serviceId && services.some((row: any) => row.service?.id === serviceId) ? serviceId : null) ??
    services[0]?.service?.id ??
    null;
  const selectedAddress = bookableAddresses.find((a: any) => a.id === addressId) ?? null;
  // UX-only preview of the resolved service zone — the booking-creation DB
  // trigger re-resolves this itself and is the sole authoritative guard
  // (zone_id is never accepted from the client, see Module 2 migration).
  const zoneQ = useResolveZone(selectedAddress?.lat, selectedAddress?.lng);

  // Seed the address step from the customer's real default/most-recent
  // bookable saved address once it loads. Only runs once, before the
  // customer has interacted with this step, so it never clobbers their edits.
  useEffect(() => {
    if (addressId === null && bookableAddresses.length > 0) {
      const def = bookableAddresses.find((a: any) => a.is_default) ?? bookableAddresses[0];
      setAddressId(def.id);
      setAddress(
        [def.street ?? def.line1, def.building, def.compound, def.area].filter(Boolean).join(", "),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addrsQ.data]);

  // Auto-select the admin-configured default payment method once it loads —
  // the customer can still change it in the payment step before confirming.
  useEffect(() => {
    if (paymentMethodId === null && (methodsQ.data?.length ?? 0) > 0) {
      const methods = methodsQ.data!;
      const def = methods.find((m) => m.is_default) ?? methods[0];
      setPaymentMethodId(def.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [methodsQ.data]);

  const lang = currentLang();
  const activeService = useMemo(
    () => services.find((s: any) => s.service?.id === serviceId) ?? services[0],
    [services, serviceId],
  );
  const isBabysitting = isBabysittingCategorySlug(activeService?.service?.category?.slug);
  const isTutoring = isTutoringCategorySlug(activeService?.service?.category?.slug);
  const capabilitiesQ = useApprovedTeachingCapabilities(
    providerId,
    activeService?.service?.id ?? serviceId ?? undefined,
  );
  const selectedCapability =
    (capabilitiesQ.data ?? []).find((row) => row.id === capabilityId) ??
    (capabilitiesQ.data ?? []).find((row) => row.id === searchCapabilityId) ??
    null;
  const requestedCapabilityMissing =
    isTutoring && !!searchCapabilityId && !capabilitiesQ.isLoading && !selectedCapability;
  const fixedPackage = !isTutoring && isFixedPackage(activeService?.service);
  const fixedStart = fixedPackage ? activeService?.service?.fixed_start_time : null;
  const needsPackageRate = fixedPackage && activeService?.price_override == null;
  const packageRateQ = useFixedPackageRate(providerId, needsPackageRate ? activeService?.service?.id : undefined, slotAddressId);
  const hours = selectedCapability ? selectedCapability.durationMin / 60 : fixedPackage ? Number(activeService?.service?.duration_min) / 60 : parseInt(duration);
  // Must run unconditionally on every render (Rules of Hooks) — this was
  // previously declared after the loading/not-found early returns below,
  // so the hook count changed between the first render (still loading,
  // returns early) and the next one, which crashes React with a hooks
  // order mismatch as soon as the provider/services queries resolve.
  const slotsQ = useAvailableSlots(
    providerId,
    date,
    selectedCapability?.durationMin || hours * 60 || 120,
    {
      serviceId: activeService?.service?.id ?? serviceId,
      addressId: slotAddressId,
      cairoTime: fixedPackage,
      fixedStartTime: fixedStart,
    },
  );
  const bookingSettingsQ = useProviderBookingSettings(providerId, {
    serviceId: eligibilityServiceId,
    addressId: slotAddressId,
  });
  const requirementsQ = useRequirementsForService(activeService?.service?.id);
  const stepKeys = BOOKING_SCREENS;
  const stepKey = requestedStep;
  const step = stepKeys.indexOf(stepKey);
  const scheduleStep = stepKeys.indexOf("when");
  const setStep = (index: number) => setRequestedStep(stepKeys[index] ?? "service");


  useEffect(() => {
    if (isBabysitting && forWhom === "myself") {
      setForWhom(defaultForWhom(true));
    } else if (!isBabysitting && forWhom === "") {
      setForWhom(defaultForWhom(false));
    }
  }, [isBabysitting, forWhom]);

  const packageSlots = useMemo(() => filterFixedStartSlots(slotsQ.data ?? [], activeService?.service), [slotsQ.data, activeService?.service]);
  useEffect(() => {
    if (!fixedStart) return;
    const slot = !slotsQ.isFetching && !slotsQ.isError ? packageSlots[0] : undefined;
    setTime(slot?.label ?? null);
    setSelectedSlot(slot ? { start: slot.start, end: slot.end } : null);
  }, [fixedStart, packageSlots, slotsQ.isFetching, slotsQ.isError]);

  const studentEducation = useMemo(
    () =>
      resolveStudentEducationProfile({
        forWhom,
        customerProfile: customerEducationQ.data,
        customerFullName: myProfileQ.data?.full_name,
        familyMembers: familyMembersQ.data ?? [],
      }),
    [forWhom, customerEducationQ.data, myProfileQ.data?.full_name, familyMembersQ.data],
  );

  useEffect(() => {
    if (!isTutoring) return;
    setBookingEducation(
      educationValueFromIds(
        studentEducation.educationCurriculumId,
        studentEducation.educationLevelId,
      ),
    );
    userPickedCapabilityRef.current = false;
  }, [
    isTutoring,
    forWhom,
    studentEducation.educationCurriculumId,
    studentEducation.educationLevelId,
  ]);

  useEffect(() => {
    if (stepKey !== "service" || !isTutoring || userPickedCapabilityRef.current) return;
    const match = pickDefaultCapabilityForEducation(
      capabilitiesQ.data ?? [],
      activeService?.service?.id ?? serviceId,
      bookingEducation.educationCurriculumId || studentEducation.educationCurriculumId,
      bookingEducation.educationLevelId || studentEducation.educationLevelId,
    );
    setCapabilityId(
      resolveAutoFillCapabilityId({
        match,
        userPickedCapability: userPickedCapabilityRef.current,
        currentCapabilityId: capabilityId,
      }),
    );
  }, [
    stepKey,
    isTutoring,
    capabilitiesQ.data,
    activeService?.service?.id,
    serviceId,
    bookingEducation.educationCurriculumId,
    bookingEducation.educationLevelId,
    studentEducation.educationCurriculumId,
    studentEducation.educationLevelId,
    capabilityId,
  ]);

  useEffect(() => {
    if (step !== scheduleStep) {
      setScanningSchedule(false);
      return;
    }
    if (!date) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      setDate(d);
      return;
    }
    if (slotsQ.isLoading || slotsQ.isFetching) return;
    if (slotsQ.isError) {
      setScanningSchedule(false);
      return;
    }
    if (userPickedDateRef.current) {
      setScanningSchedule(false);
      return;
    }
    if (packageSlots.length > 0) {
      setScanningSchedule(false);
      return;
    }

    const maxDays = Math.min(14, bookingSettingsQ.data?.max_advance_days ?? 12);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayIndex = Math.round((date.getTime() - today.getTime()) / 86400000);
    if (dayIndex + 1 < maxDays) {
      setScanningSchedule(true);
      const next = new Date(date);
      next.setDate(next.getDate() + 1);
      setDate(next);
      setTime(null);
      setSelectedSlot(null);
      return;
    }
    setScanningSchedule(false);
  }, [
    step,
    scheduleStep,
    date,
    slotsQ.isLoading,
    slotsQ.isFetching,
    slotsQ.isError,
    packageSlots,
    bookingSettingsQ.data?.max_advance_days,
  ]);

  const otherProviders = <Link to={previewPath("/search") as "/search"} search={{ serviceId: activeService?.service?.id ?? serviceId ?? undefined }} className="inline-flex min-h-11 items-center px-3 text-sm font-bold text-brand underline">{t("bookingUx.otherProviders")}</Link>;
  if (provQ.isError || servicesQ.isError || bookingSettingsQ.isError) {
    return <PhoneFrame><QueryError onRetry={() => { void provQ.refetch(); void servicesQ.refetch(); void bookingSettingsQ.refetch(); }} />{otherProviders}</PhoneFrame>;
  }
  if (provQ.isLoading || servicesQ.isLoading || bookingSettingsQ.isLoading || (needsPackageRate && packageRateQ.isLoading)) {
    return (
      <PhoneFrame>
        <div className="grid flex-1 place-items-center">
          <Loader2 className="h-6 w-6 animate-spin text-brand" />
        </div>
      </PhoneFrame>
    );
  }
  if (!bookingSettingsQ.data) {
    return (
      <PhoneFrame>
        <EmptyState
          icon="ban"
          title={t("bookFlow.unavailable")}
          body={t("bookFlow.unavailableBody")}
          action={
            <div>{otherProviders}<Link to={previewPath("/addresses/new") as "/addresses/new"} className="inline-flex min-h-11 items-center px-3 text-sm font-bold text-brand">{t("addresses.addAddress")}</Link></div>
          }
        />
      </PhoneFrame>
    );
  }

  const p = provQ.data ? toUIProvider(provQ.data) : null;
  if (!p) {
    return (
      <PhoneFrame>
        <EmptyState
          icon="ban"
          title={t("bookFlow.unavailable")}
          body={t("bookFlow.unavailableBody")}
          action={
            <div>{otherProviders}<Link to={previewPath("/addresses/new") as "/addresses/new"} className="inline-flex min-h-11 items-center px-3 text-sm font-bold text-brand">{t("addresses.addAddress")}</Link></div>
          }
        />
      </PhoneFrame>
    );
  }

  const selectedFamilyMember =
    forWhom !== "myself" && forWhom !== ""
      ? (familyMembersQ.data ?? []).find((m: any) => m.id === forWhom)
      : null;
  const forWhomLabel =
    forWhom === "myself"
      ? t("bookFlow.forWhomMyself", "Myself")
      : (selectedFamilyMember?.full_name ?? t("bookFlow.dash"));

  if (needsPackageRate && (packageRateQ.isError || packageRateQ.data == null)) {
    return <PhoneFrame><QueryError onRetry={() => packageRateQ.refetch()} /></PhoneFrame>;
  }
  const ratePerHour = Number(activeService?.price_override ?? (needsPackageRate ? packageRateQ.data : p.hourlyRate));
  // Requirements that must be resolved before this booking can be created.
  // The server re-derives/validates all of this itself (tg_validate_booking_service)
  // — this is purely so the customer sees the right total and can't submit
  // an incomplete "either" choice.
  const bookingRequirements = (requirementsQ.data ?? []).filter(
    (r: any) => r.required_during_booking,
  );
  const eitherRequirements = bookingRequirements.filter(
    (r: any) => r.fulfillment_mode === "either",
  );
  const { tutoringQuote, subtotal, fee, vat, extrasTotal, travelFee, total } = buildBookingQuote({
    service: activeService?.service,
    rate: ratePerHour,
    hours,
    capability: selectedCapability,
    fee: billingQ.data?.platform_fee ?? DEFAULT_BILLING_SETTINGS.platform_fee,
    vatPercent: billingQ.data?.vat_percent ?? DEFAULT_BILLING_SETTINGS.vat_percent,
    requirements: bookingRequirements,
    requirementChoices,
    travelFee: Number(zoneQ.data?.travel_fee ?? 0),
    promoDiscount,
  });

  const requirementsReady = requirementsQ.isSuccess && eitherRequirements.every((r: any) => !!requirementChoices[r.id]);
  const missingStep = bookingScreenMissingStep(stepKey, {
    service: !!activeService,
    tutoring: isTutoring,
    capability: !!selectedCapability,
    slot: !!date && !!time && (!fixedPackage || !!selectedSlot),
    address: !!addressId && !!zoneQ.data,
    recipient: canContinueForWhom({ isBabysitting, forWhom, members: familyMembersQ.data ?? [], startAt: selectedSlot?.start ?? null }),
    requirements: requirementsReady,
    payment: !!paymentMethodId,
  });
  const canNext = () => missingStep === null;
  const paymentCopy = paymentPresentation((methodsQ.data ?? []).find(method => method.id === paymentMethodId)?.method_type);
  const noPaymentMethods = methodsQ.isSuccess && methodsQ.data.length === 0;
  const stepQuery = missingStep === "requirements" ? requirementsQ : missingStep === "duration" ? capabilitiesQ : missingStep === "schedule" ? slotsQ : missingStep === "address" ? (!addressId ? addrsQ : zoneQ) : missingStep === "forWhom" ? familyMembersQ : missingStep === "payment" ? methodsQ : servicesQ;
  const disabledReason = bookingDisabledReason({ step: missingStep ?? "summary", allowed: canNext(), submitting: createBooking.isPending, loading: stepQuery.isLoading, error: stepQuery.isError, hasDate: !!date, hasSlots: packageSlots.length > 0, hasAddress: !!addressId });
  const clearSlot = () => { setTime(null); setSelectedSlot(null); setInlineError(null); };
  const editScreen = (screen: BookingScreen) => { setEditingReview(true); setRequestedStep(screen); };
  const visibleCapabilities = (capabilitiesQ.data ?? []).filter((cap) =>
    (!bookingEducation.educationCurriculumId || cap.curriculumId === bookingEducation.educationCurriculumId) &&
    (!bookingEducation.educationLevelId || cap.levelId === bookingEducation.educationLevelId));
  const subjectGroups = groupBookingSubjects(visibleCapabilities);
  const selectedGroup = subjectGroups.find(group => group.capabilities.some(cap => cap.id === selectedCapability?.id));

  const applyPromo = async () => {
    const code = promoCode.trim();
    if (!code) return;
    setPromoStatus("checking");
    try {
      const result = await validatePromoCode(code, activeService?.service?.id ?? null, subtotal);
      if (result.ok) {
        setPromoDiscount(result.discount_amount);
        setAppliedPromoId(result.promo_code_id);
        setPromoStatus("applied");
        toast.success(t("bookFlow.promoApplied", { amount: formatEGP(result.discount_amount) }));
      } else {
        setPromoDiscount(0);
        setAppliedPromoId(null);
        setPromoStatus("invalid");
        toast.error(t(`bookFlow.promoError.${result.reason}`, t("bookFlow.promoError.not_found")));
      }
    } catch (e: any) {
      setPromoDiscount(0);
      setAppliedPromoId(null);
      setPromoStatus("invalid");
      toast.error(e?.message ?? t("bookFlow.promoError.not_found"));
    }
  };

  const submit = async () => {
    setInlineError(null);
    if (!activeService?.service?.id) {
      toast.error(t("bookFlow.missingService", "Please select a service."));
      return;
    }
    if (!date || !time) {
      toast.error(t("bookFlow.missingSlot", "Please select an available time slot."));
      return;
    }
    const selectedMethod = (methodsQ.data ?? []).find((m) => m.id === paymentMethodId);
    if (!selectedMethod) {
      toast.error(t("bookFlow.paymentFailed", "Could not record payment method"));
      return;
    }
    // Use the real slot's start/end (set when the customer picked it from
    // real availability data) rather than re-parsing the display label —
    // more robust than string-matching a locale-formatted time string.
    let start: Date, end: Date;
    if (selectedSlot) {
      start = selectedSlot.start;
      end = selectedSlot.end;
    } else {
      const [hh, mm, ampm] = time.match(/(\d+):(\d+)\s*(\w+)/)!.slice(1);
      let h = parseInt(hh);
      if (ampm.toUpperCase() === "PM" && h !== 12) h += 12;
      start = new Date(date);
      start.setHours(h, parseInt(mm), 0, 0);
      end = new Date(start.getTime() + hours * 60 * 60 * 1000);
    }
    try {
      // UX-only pre-flight check. This does NOT guarantee consistency and
      // must never be treated as the source of truth — a real race
      // condition (two customers submitting at the same instant) can still
      // pass this check for both. The database's bookings_no_overlap
      // exclusion constraint (extended in migration 20260713150000 to cover
      // every active-lifecycle status) is the sole authoritative guard;
      // useCreateBooking() below still independently catches and surfaces
      // that constraint's 23P01 error regardless of what this check finds.
      // This exists only to give faster, more specific feedback in the
      // common (non-race) case.
      const { data: clashes, error: clashErr } = await supabase
        .from("bookings")
        .select("id")
        .eq("provider_id", p.id)
        .in("status", [
          "pending",
          "confirmed",
          "on_the_way",
          "arrived",
          "arrival_confirmed",
          "in_progress",
          "completion_requested",
        ])
        .lt("start_at", end.toISOString())
        .gt("end_at", start.toISOString())
        .limit(1);
      if (clashErr) throw clashErr;
      if (clashes && clashes.length > 0) {
        toast.error(t("bookFlow.slotTaken", "That time slot was just taken. Please pick another."));
        setInlineError({ screen: "when", message: t("bookFlow.slotTaken") });
        setTime(null);
        setSelectedSlot(null);
        setEditingReview(false);
        setStep(scheduleStep);
        return;
      }

      const submissionPayload = buildBookingRequest({
        providerId: p.id,
        serviceId: activeService.service.id,
        addressId: addressId!,
        forWhom, start, end, promoStatus, appliedPromoId, notes,
        eitherRequirements, requirementChoices, selectedCapability,
      });
      const fingerprint = bookingSubmissionFingerprint(submissionPayload);
      idempotencyStateRef.current = resolveIdempotencyKey(idempotencyStateRef.current, fingerprint);

      const booking = await createBooking.mutateAsync({
        ...submissionPayload,
        idempotency_key: idempotencyStateRef.current.key,
      });

      if (
        shouldPersistEducationAfterBookingSuccess({
          bookingSucceeded: true,
          isTutoring,
          saveForNextTime: saveEducationForNextTime,
          draft: {
            educationCurriculumId: bookingEducation.educationCurriculumId || null,
            educationLevelId: bookingEducation.educationLevelId || null,
          },
          saved: {
            educationCurriculumId: studentEducation.educationCurriculumId,
            educationLevelId: studentEducation.educationLevelId,
          },
        })
      ) {
        const persistResult = await persistEducationProfileAfterBooking({
          save: () =>
            saveEducation.save({
              forWhom,
              education_curriculum_id: bookingEducation.educationCurriculumId || null,
              education_level_id: bookingEducation.educationLevelId || null,
            }),
        });
        if (!persistResult.ok) {
          toast.error(
            t(
              "studentEducation.saveFailed",
              "Your booking was created, but we could not save school details for next time.",
            ),
          );
        }
      }

      const paymentPlan = planPostCreatePayment(booking, selectedMethod);
      let onlineCheckoutStarted = false;
      if (paymentPlan.action === "create_now") {
        // Amount is loaded server-side from bookings.price_total inside useCreatePayment.
        try {
          const payment = await createPayment.mutateAsync({
            bookingId: booking.id,
            paymentMethodId: paymentPlan.paymentMethodId,
            methodType: paymentPlan.methodType,
          });
          if (paymentPlan.methodType === "online" && payment?.id) {
            const checkout = await redirectToPaymobCheckout(booking.id, payment.id);
            if (checkout.ok) {
              onlineCheckoutStarted = true;
            } else {
              toast.error(
                checkout.message ||
                  t("payment.paymobStartFailed", "Could not start online payment."),
              );
            }
          }
        } catch (pe: unknown) {
          setInlineError({ screen: "review", message: mapPaymentInsertError(pe) || t("bookFlow.paymentFailed") });
          toast.error(
            mapPaymentInsertError(pe) ||
              t("bookFlow.paymentFailed", "Could not record payment method"),
          );
        }
      } else {
        stashPendingPayment(paymentPlan.bookingId, {
          paymentMethodId: paymentPlan.paymentMethodId,
          methodType: paymentPlan.methodType,
        });
        toast.info(
          t(
            "bookFlow.paymentDeferred",
            "Your booking was created. Payment details will load on the booking page.",
          ),
        );
      }
      if (!booking.idempotent_replay) {
        toast.success(t("bookFlow.created", "Booking created"));
        if (booking.created) markCustomerPushPromptPending();
      }
      if (onlineCheckoutStarted) return;
      nav({
        to: "/booking/$id",
        params: { id: booking.id },
        search: selectedMethod.method_type === "online" ? { paymob_checkout: "1" } : undefined,
      });
    } catch (e: any) {
      const code = e instanceof BookingError ? e.code : null;
      setInlineError({ screen: isSlotStaleBookingError(code) ? "when" : "review", message: getBookingErrorMessage(e, (key, fallback) => t(key, fallback ?? "")) });
      if (isSlotStaleBookingError(code)) {
        toast.error(getBookingErrorMessage(e, (key, fallback) => t(key, fallback ?? "")));
        setTime(null);
        setSelectedSlot(null);
        setEditingReview(false);
        setStep(scheduleStep);
        return;
      }
      toast.error(getBookingErrorMessage(e, (key, fallback) => t(key, fallback ?? "")));
    }
  };

  const next = () => {
    if (stepKey === "review") void submit();
    else { setRequestedStep(nextBookingScreen(stepKey, editingReview)); setEditingReview(false); }
  };
  const locale = lang === "ar" ? "ar-EG" : "en-US";
  const firstName = p.name.split(" ")[0];
  const serviceName = (lang === "ar" ? activeService?.service?.name_ar : activeService?.service?.name_en) ?? "";
  const durationText = tutoringQuote ? t("bookFlow.sessionLine", { minutes: formatNumber(tutoringQuote.durationMin) })
    : fixedPackage ? t(packageLabel(activeService.service).key, packageLabel(activeService.service).values)
    : t("customerBooking.duration", { hours: formatNumber(hours) });
  const whenText = date && selectedSlot ? t("customerBooking.whenSummary", bookingWhenValues(date, selectedSlot, locale, fixedPackage)) : t("bookFlow.dash");

  const handleBack = () => {
    if (step === 0) nav({ to: previewPath("/provider/$id") as "/provider/$id", params: { id: p.id } });
    else setStep(step - 1);
  };

  const recipientFields = <Step title={t(isTutoring ? "bookFlow.forWhomTitle" : "customerBooking.who", { name: firstName })}>
    <div className="apply-chips">
      {showMyselfOption(isBabysitting) && <CheckChip selected={forWhom === "myself"} onClick={() => setForWhom("myself")}>{t("bookFlow.forWhomMyself")}</CheckChip>}
      {familyMembersQ.isError ? <QueryError onRetry={() => familyMembersQ.refetch()} /> : familyMembersQ.isLoading ? <p role="status">{t("common.loading")}</p> : (familyMembersQ.data ?? []).map((member) => {
        const selectable = isBabysitting ? familyMemberSelectableForBabysitting(member, selectedSlot?.start ?? null) : { ok: true };
        return <CheckChip key={member.id} selected={forWhom === member.id} disabled={!selectable.ok} onClick={() => setForWhom(member.id)}>
          {member.full_name}{!selectable.ok && <span className="text-xs">{t("bookFlow.forWhomAgeOutOfRange")}</span>}
        </CheckChip>;
      })}
      <button type="button" className="apply-chip" onClick={() => setDetailsSheet("member")}>{t("customerBooking.addMember")}</button>
    </div>
    {!familyMembersQ.isLoading && (familyMembersQ.data ?? []).length === 0 && <p className="text-xs text-muted-foreground">{t(isBabysitting ? "bookFlow.forWhomNeedChild" : "bookFlow.noFamilyMembers")}</p>}
  </Step>;

  return (
    <PhoneFrame bg="bg-background">
      <main className="apply-ui apply-screen booking-screen" dir={lang === "ar" ? "rtl" : "ltr"}>
        <StepHeader step={step + 1} total={4} onBack={handleBack} />
        <div className="apply-content">
          <h1 className="apply-title">{t(`customerBooking.titles.${stepKey}`, { name: firstName })}</h1>
          {inlineError?.screen === stepKey && <p role="alert" className="booking-error">{inlineError.message}</p>}
          {stepKey === "service" && <>
            <div className="booking-provider">
              <ProfileAvatar src={p.avatar} name={p.name} />
              <span className="booking-provider-text"><b>{p.name}</b><small><Star size={13} className="inline text-warning" /> {formatNumber(p.rating)} · {t("customerBooking.jobs", { count: p.jobs })} · {p.areas.join(" · ")}</small></span>
            </div>
            {services.length === 0 ? <div><p>{t("bookFlow.noServices")}</p>{otherProviders}</div> : services.map((s: any) => {
              const active = activeService?.service?.id === s.service.id;
              const fixed = isFixedPackage(s.service);
              const teaching = isTutoringCategorySlug(s.service.category?.slug);
              const label = (lang === "ar" ? s.service.name_ar : s.service.name_en) || s.service.name_en;
              const approvedPrices = (capabilitiesQ.data ?? []).filter(cap => cap.serviceId === s.service.id && cap.status === "approved").map(cap => cap.price);
              const teachingSubtitle = approvedPrices.length ? t("customerBooking.tutoringFrom", { price: formatNumber(Math.min(...approvedPrices)) }) : t("customerBooking.tutoringPrice");
              const subtitle = fixed ? applyServiceSubtitle(s.service, t) : teaching ? teachingSubtitle : `${formatNumber(Number(s.price_override ?? p.hourlyRate))} ${t("pricePicker.hourUnit")}`;
              return <ServiceCard key={s.service.id} selected={active} title={label} subtitle={subtitle} trailing={fixed && s.price_override != null ? <b className="booking-package-price">{formatEGP(Number(s.price_override))}</b> : undefined} icon={fixed ? (s.service.fixed_start_time ? <Clock size={22} /> : <Sun size={22} />) : teaching ? <BookOpen size={22} /> : <UserRound size={22} />}
                onClick={() => { setServiceId(s.service.id); setCapabilityId(null); clearSlot(); }}>
                {!teaching && !fixed && <NumberStepper value={parseInt(duration)} min={2} max={8} step={2} unitLabel={t("customerBooking.hours")} hint={t("customerBooking.hoursRange", { min: 2, max: 8 })} onChange={(hours) => { setDuration(`${hours}h`); clearSlot(); }} />}
                {fixed && s.price_override == null && <b className="text-sm">{formatEGP(active ? subtotal : Number(s.price_override ?? p.hourlyRate))} · {t("packages.fixedPrice")}</b>}
              </ServiceCard>;
            })}
            {isTutoring && <>
              {recipientFields}
              <Step title={t("bookFlow.pickCapability")}>
                <details className="booking-section" open={!bookingEducation.educationCurriculumId || !bookingEducation.educationLevelId ? true : undefined}>
                  <summary className="booking-add">{t("customerBooking.schoolDetails")}</summary>
                  <EducationProfileFields value={bookingEducation} onChange={(next) => {
                    userPickedCapabilityRef.current = true;
                    setBookingEducation(next);
                    const match = pickDefaultCapabilityForEducation(capabilitiesQ.data ?? [], activeService?.service?.id ?? serviceId, next.educationCurriculumId || null, next.educationLevelId || null);
                    setCapabilityId(match?.id ?? null); clearSlot();
                  }} />
                  <label className="apply-agree"><input type="checkbox" checked={saveEducationForNextTime} onChange={(event) => setSaveEducationForNextTime(event.target.checked)} className="sr-only" /><span className={`apply-checkbox ${saveEducationForNextTime ? "on" : ""}`}>{saveEducationForNextTime && <Check size={14} />}</span>{t("studentEducation.saveForNextTime")}</label>
                </details>
                {requestedCapabilityMissing && <p className="booking-error">{t("bookFlow.capabilityUnavailable")}</p>}
                {capabilitiesQ.isError ? <QueryError onRetry={() => capabilitiesQ.refetch()} /> : capabilitiesQ.isLoading ? <p role="status">{t("common.loading")}</p> : subjectGroups.length === 0 ? <div><p>{t("bookFlow.noCapabilities")}</p>{otherProviders}</div> : subjectGroups.map(group => {
                  const cap = group.capabilities[0];
                  const active = group === selectedGroup;
                  const chosen = active ? selectedCapability ?? cap : cap;
                  const title = [lang === "ar" ? cap.subjectNameAr : cap.subjectNameEn, lang === "ar" ? cap.curriculumNameAr : cap.curriculumNameEn, lang === "ar" ? cap.levelNameAr : cap.levelNameEn].join(" · ");
                  return <ServiceCard key={group.key} selected={active} title={title} subtitle={`${formatNumber(chosen.price)} ${t("pricePicker.sessionUnit")}`} icon={<BookOpen size={22} />}
                    onClick={() => { userPickedCapabilityRef.current = true; setCapabilityId(cap.id); setBookingEducation(educationValueFromIds(cap.curriculumId, cap.levelId)); clearSlot(); }} />;
                })}
                {selectedGroup && <div><span className="apply-label">{t("customerBooking.sessionDuration")}</span><div className="apply-chips">{selectedGroup.capabilities.map(cap => <CheckChip key={cap.id} selected={cap.id === selectedCapability?.id} onClick={() => { userPickedCapabilityRef.current = true; setCapabilityId(cap.id); clearSlot(); }}>{t("bookFlow.sessionLine", { minutes: formatNumber(cap.durationMin) })}</CheckChip>)}</div></div>}
              </Step>
            </>}
          </>}
          {stepKey === "when" && <>
            <BookingWhen providerId={providerId} serviceId={activeService?.service?.id ?? serviceId ?? ""} addressId={slotAddressId} service={activeService?.service ?? {}} durationMinutes={selectedCapability?.durationMin || hours * 60 || 120} maxAdvanceDays={bookingSettingsQ.data?.max_advance_days ?? 12} cairoTime={fixedPackage} locale={locale}
              date={date} time={time} slots={packageSlots} loading={slotsQ.isLoading || slotsQ.isFetching || scanningSchedule} error={slotsQ.isError} onRetry={() => void slotsQ.refetch()}
              onDateChange={(day) => { userPickedDateRef.current = true; setScanningSchedule(false); setDate(day); clearSlot(); }}
              onTimeChange={(slot) => { setTime(slot.label); setSelectedSlot({ start: slot.start, end: slot.end }); setInlineError(null); }} />
            {!slotsQ.isLoading && packageSlots.length === 0 && otherProviders}
          </>}
        {stepKey === "whereWho" && (
          <Step title={t("customerBooking.address")} sub={t("bookFlow.addressSub")}>
            <div id="booking-addresses" tabIndex={-1} />
            {addrsQ.isError ? <QueryError onRetry={() => addrsQ.refetch()} /> : addrsQ.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className="h-16 animate-pulse rounded-2xl bg-surface-2" />
                ))}
              </div>
            ) : bookableAddresses.length === 0 ? (
              <EmptyState
                icon="map-pin"
                title={t("bookFlow.noBookableAddress", "Add an address to continue")}
                body={
                  (addrsQ.data?.length ?? 0) > 0
                    ? t(
                        "bookFlow.addressesNeedLocation",
                        "Your saved addresses are missing a pinned location. Add one to book.",
                      )
                    : t("bookFlow.noAddressesYet", "You haven't saved an address yet.")
                }
                action={
                  <button type="button" onClick={() => setDetailsSheet("address")}
                    className="focus-ring tap-scale inline-flex items-center gap-1.5 rounded-full bg-brand px-5 py-3 text-sm font-extrabold text-brand-foreground"
                  >
                    {t("customerBooking.addAddress")}
                  </button>
                }
              />
            ) : (
              <div className="space-y-2">
                {bookableAddresses.map((a: any) => {
                  const Icon =
                    a.label === "home"
                      ? Home
                      : a.label === "work"
                        ? Briefcase
                        : a.label === "family"
                          ? Users
                          : MapPin;
                  const title =
                    a.label === "other"
                      ? a.custom_label || t("addresses.label.other")
                      : t(`addresses.label.${a.label}`);
                  const lineParts = [a.street ?? a.line1, a.building, a.compound, a.area].filter(
                    Boolean,
                  );
                  return (
                    <button
                      key={a.id}
                      onClick={() => {
                        setAddressId(a.id);
                        setAddress(lineParts.join(", "));
                      }}
                      aria-pressed={addressId === a.id}
                      className={`booking-option ${addressId === a.id ? "on" : ""}`}
                    >
                      <span className="apply-tile"><Icon size={20} /></span>
                      <div className="booking-option-text">
                        <div className="text-sm font-bold">{title}</div>
                        <div className="text-xs text-muted-foreground">
                          {lineParts.join(", ")}
                        </div>
                      </div>
                      <span className={`booking-radio ${addressId === a.id ? "on" : ""}`} aria-hidden="true" />
                    </button>
                  );
                })}
                <button type="button" onClick={() => setDetailsSheet("address")}
                  className="focus-ring flex w-full items-center gap-2 rounded-[1.25rem] border border-dashed border-brand/40 p-3.5 text-sm font-extrabold text-brand"
                >
                  {t("customerBooking.addAddress")}
                </button>
              </div>
            )}
            {selectedAddress && (
              <div className="mt-3">
                {zoneQ.isError ? <QueryError onRetry={() => zoneQ.refetch()} /> : zoneQ.isLoading ? (
                  <div className="h-10 animate-pulse rounded-xl bg-surface-2" />
                ) : zoneQ.data ? (
                  <div className="flex items-center gap-2 rounded-full bg-success/10 px-3.5 py-2.5 text-xs font-bold text-foreground">
                    <MapPin className="h-3.5 w-3.5 text-success" />
                    {t("bookFlow.zoneServed", "Serves {{zone}}", {
                      zone: lang === "ar" ? zoneQ.data.name_ar : zoneQ.data.name_en,
                    })}
                  </div>
                ) : (
                  <div className="flex flex-wrap items-start gap-2 rounded-[1.25rem] bg-brand/8 px-3.5 py-2.5 text-xs font-bold text-brand">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {t(
                      "bookFlow.zoneNotServed",
                      "This area is not currently served. Please choose another address.",
                    )}
                    <button type="button" className="min-h-11 underline" onClick={() => { document.getElementById("booking-addresses")?.scrollIntoView({ block: "center" }); document.getElementById("booking-addresses")?.focus(); }}>{t("bookingUx.changeAddress")}</button>
                    <button type="button" onClick={() => setDetailsSheet("address")} className="inline-flex min-h-11 items-center underline">{t("customerBooking.addAddress")}</button>
                  </div>
                )}
              </div>
            )}
          </Step>
        )}

          {stepKey === "whereWho" && !isTutoring && recipientFields}
        {stepKey === "whereWho" && (!requirementsQ.isSuccess || bookingRequirements.length > 0) && (
          <Step
            title={t("bookFlow.requirementsTitle", "Requirements")}
            sub={t("bookFlow.requirementsSub", "Some items for this service need to be arranged.")}
          >
            {requirementsQ.isError ? <QueryError onRetry={() => requirementsQ.refetch()} /> : !requirementsQ.isSuccess ? (
              <p role="status">{t("common.loading")}</p>
            ) : bookingRequirements.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("bookFlow.noRequirements", "Nothing extra needed for this service.")}
              </p>
            ) : (
              <div className="space-y-3">
                {bookingRequirements.map((r: any) => {
                  const name = lang === "ar" ? r.name_ar : r.name_en;
                  if (r.fulfillment_mode !== "either") {
                    return (
                      <Card key={r.id} className="p-3 text-sm">
                        <div className="font-bold">{name}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.fulfillment_mode === "provider"
                            ? t(
                                "bookFlow.reqProviderProvides",
                                "Provided by your professional — {{fee}}",
                                { fee: formatEGP(Number(r.provider_extra_fee)) },
                              )
                            : t("bookFlow.reqYouProvide", "You provide this")}
                        </div>
                      </Card>
                    );
                  }
                  const choice = requirementChoices[r.id];
                  return (
                    <Card key={r.id} className="p-3">
                      <div className="text-sm font-bold">{name}</div>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <button
                          onClick={() =>
                            setRequirementChoices((c) => ({ ...c, [r.id]: "customer" }))
                          }
                          aria-pressed={choice === "customer"} className={`apply-chip ${choice === "customer" ? "on" : ""}`}
                        >
                          {t("bookFlow.reqIWillProvide", "I will provide it")}
                        </button>
                        <button
                          onClick={() =>
                            setRequirementChoices((c) => ({ ...c, [r.id]: "provider" }))
                          }
                          aria-pressed={choice === "provider"} className={`apply-chip ${choice === "provider" ? "on" : ""}`}
                        >
                          {t("bookFlow.reqProviderWillProvide", "Provider provides — {{fee}}", {
                            fee: formatEGP(Number(r.provider_extra_fee)),
                          })}
                        </button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </Step>
        )}


          {stepKey === "whereWho" && <label><span className="apply-label">{t("customerBooking.notes", { name: firstName })}</span><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("bookFlow.notesPlaceholder")} className="booking-notes" /></label>}
          {stepKey === "review" && <>
            <div>
              <ReviewRow label={t("bookFlow.stepName.service")} value={`${serviceName} · ${durationText}`} onEdit={() => editScreen("service")} />
              <ReviewRow label={t("bookFlow.rowDate")} value={whenText} onEdit={() => editScreen("when")} />
              <ReviewRow label={t("bookFlow.rowAddress")} value={address} onEdit={() => editScreen("whereWho")} />
              <ReviewRow label={t("customerBooking.recipient")} value={forWhomLabel} onEdit={() => editScreen(isTutoring ? "service" : "whereWho")} />
              {notes && <ReviewRow label={t("bookFlow.rowNotes")} value={notes} onEdit={() => editScreen("whereWho")} />}
            </div>
            <div className="booking-bill">
              <Row label={tutoringQuote ? t("bookFlow.sessionLine", { minutes: formatNumber(tutoringQuote.durationMin) }) : fixedPackage ? t("packages.fixedPrice") : t("customerBooking.rateLine", { rate: formatEGP(ratePerHour), hours: formatNumber(hours) })} value={formatEGP(subtotal)} />
              <Row label={t("bookFlow.serviceFee")} value={formatEGP(fee)} />
              <Row label={t("bookFlow.vat")} value={formatEGP(vat)} />
              {extrasTotal > 0 && <Row label={t("bookFlow.extrasTotal")} value={formatEGP(extrasTotal)} />}
              {travelFee > 0 && <Row label={t("bookFlow.travelFee")} value={formatEGP(travelFee)} />}
              {promoDiscount > 0 && <Row label={t("bookFlow.promoDiscount")} value={`-${formatEGP(promoDiscount)}`} />}
              <div className="booking-total"><span>{t("bookFlow.total")}</span><span>{formatEGP(total)}</span></div>
            </div>
            {billingQ.isError && <QueryError onRetry={() => billingQ.refetch()} />}
            <details><summary className="booking-add">{t("customerBooking.promo")}</summary>
              <div className="mt-3 border-t border-border pt-3">
                <div className="flex items-center gap-2">
                  <TextField
                    label={t("bookFlow.promoPlaceholder")}
                    value={promoCode}
                    onChange={(e) => {
                      setPromoCode(e.target.value);
                      if (promoStatus !== "idle") {
                        setPromoStatus("idle");
                        setPromoDiscount(0);
                        setAppliedPromoId(null);
                      }
                    }}
                    placeholder={t("bookFlow.promoPlaceholder")}
                    disabled={promoStatus === "applied"}
                    className="h-12 min-w-0 flex-1 rounded-full bg-surface-2 px-4 text-sm font-bold outline-none focus:ring-1 focus:ring-brand disabled:opacity-60"
                  />
                  {promoStatus === "applied" ? (
                    <button
                      onClick={() => {
                        setPromoCode("");
                        setPromoStatus("idle");
                        setPromoDiscount(0);
                        setAppliedPromoId(null);
                      }}
                      aria-label={t("bookFlow.promoRemove")}
                      className="h-12 shrink-0 rounded-full border border-border px-4 text-sm font-bold text-muted-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      onClick={applyPromo}
                      disabled={!promoCode.trim() || promoStatus === "checking"}
                      className="h-12 shrink-0 rounded-full bg-brand px-5 text-sm font-extrabold text-brand-foreground disabled:opacity-50"
                    >
                      {promoStatus === "checking" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        t("bookFlow.promoApply")
                      )}
                    </button>
                  )}
                </div>
                {promoStatus === "applied" && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-success">
                    <Check className="h-3 w-3" aria-hidden="true" />
                    {t("bookFlow.promoAppliedNote", { amount: formatEGP(promoDiscount) })}
                  </div>
                )}
              </div>
            </details>
          </>}
        {stepKey === "review" && (
          <Step title={t("bookFlow.paymentTitle")} sub={t("bookFlow.paymentSub")}>
            {methodsQ.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className="h-[72px] animate-pulse rounded-2xl bg-surface-2" />
                ))}
              </div>
            ) : methodsQ.isError ? (
              <div className="rounded-[1.25rem] bg-brand/8 p-4 text-center">
                <p className="text-sm font-bold text-brand">{t("bookFlow.paymentLoadError")}</p>
                <button
                  onClick={() => methodsQ.refetch()}
                  className="mt-2 text-xs font-extrabold text-brand underline"
                >
                  {t("common.retry")}
                </button>
              </div>
            ) : (methodsQ.data ?? []).length === 0 ? (
              <div><p className="text-sm text-muted-foreground">{t("bookFlow.paymentEmpty")}</p><Link to={previewPath("/help") as "/help"} className="inline-flex min-h-11 items-center px-3 font-bold text-brand">{t("bookingUx.contactSupport")}</Link></div>
            ) : (
              <>
                <div className="space-y-3">
                  {methodsQ.data!.map((m) => {
                    const label = lang === "ar" ? m.name_ar : m.name_en;
                    const sub =
                      (lang === "ar" ? m.instructions_ar : m.instructions_en) ?? undefined;
                    const icon =
                      m.method_type === "cash" ? (
                        <Banknote className="h-5 w-5" />
                      ) : m.code === "instapay" ? (
                        <img
                          src="/instapay.svg"
                          alt={label}
                          className="h-full w-full rounded-xl object-cover"
                        />
                      ) : (
                        <Wallet className="h-5 w-5" />
                      );
                    return (
                      <PayOption
                        key={m.id}
                        icon={icon}
                        label={label}
                        sub={sub}
                        active={paymentMethodId === m.id}
                        onClick={() => setPaymentMethodId(m.id)}
                      />
                    );
                  })}
                </div>
                <PaymentMethodInstructions
                  method={methodsQ.data!.find((m) => m.id === paymentMethodId) ?? null}
                  lang={lang}
                  t={t}
                />
              </>
            )}
            <div className="mt-4 flex items-center justify-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
              <Check className="h-3 w-3 text-success" aria-hidden="true" />
              {t("bookFlow.encrypted")}
            </div>
            {tutoringQuote ? (
              <p className="mt-3 text-center text-sm font-extrabold">
                {t("bookFlow.sessionLine", { minutes: formatNumber(tutoringQuote.durationMin) })} ·{" "}
                {formatEGP(tutoringQuote.sessionPrice)}
              </p>
            ) : null}
          </Step>
        )}
        </div>
        {missingStep && bookingScreenForStep(missingStep, isTutoring) !== stepKey && <button type="button" className="booking-add px-5" onClick={() => editScreen(bookingScreenForStep(missingStep, isTutoring))}>{t(`bookFlow.stepName.${missingStep}`)}</button>}
        {stepKey === "review" && paymentMethodId && !methodsQ.isError && <p className="px-5 text-xs text-muted-foreground">{t(paymentCopy.next)}</p>}
        <StickyCta onClick={stepKey === "review" && noPaymentMethods ? () => { void nav({ to: previewPath("/help") as "/help" }); } : next}
          disabled={!(stepKey === "review" && noPaymentMethods) && (!canNext() || createBooking.isPending)} hint={disabledReason ? (disabledReason === "bookingUx.chooseRecipient" ? t("customerBooking.chooseRecipient", { name: firstName }) : t(disabledReason)) : undefined}>
          {createBooking.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : stepKey === "review" && noPaymentMethods ? t("bookingUx.contactSupport") : t(stepKey === "review" ? "customerBooking.confirm" : "customerBooking.next", { total: formatEGP(total) })}
        </StickyCta>
        {detailsSheet && <BookingDetailsSheet kind={detailsSheet} firstAddress={(addrsQ.data?.length ?? 0) === 0} onClose={() => { setDetailsSheet(null); void addrsQ.refetch(); void familyMembersQ.refetch(); }} />}
      </main>
    </PhoneFrame>
  );
}

/** Receiver handle + Copy button for the selected method, when it has one (e.g. InstaPay). */
function PaymentMethodInstructions({
  method,
  lang,
  t,
}: {
  method: any;
  lang: string;
  t: (k: string, o?: any) => string;
}) {
  if (!method) return null;
  const config = (method.public_config ?? {}) as Record<string, unknown>;
  const handle = typeof config.handle === "string" ? config.handle : null;
  const note = typeof config.note === "string" ? config.note : null;
  if (!handle) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(handle);
      toast.success(t("payment.handleCopied"));
    } catch {
      toast.error(t("payment.copyFailed"));
    }
  };

  return (
    <div className="mt-3 space-y-2 rounded-2xl bg-surface-2 p-3">
      <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        {t("payment.transferTo")}
      </div>
      <button
        onClick={copy}
        className="flex w-full items-center justify-between gap-2 rounded-xl bg-surface p-3 text-start active:scale-[0.99]"
        aria-label={t("payment.copyHandle")}
      >
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">
            {lang === "ar" ? method.name_ar : method.name_en}
          </div>
          <div className="truncate text-sm font-extrabold text-brand" dir="ltr">
            {handle}
          </div>
        </div>
        <Copy className="h-4 w-4 text-muted-foreground" />
      </button>
      {note && <p className="text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}

function Step({ title, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return <section className="booking-section"><h2 className="apply-label">{title}</h2>{children}</section>;
}

function ReviewRow({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }) {
  const { t } = useTranslation();
  return <div className="booking-review-row"><span className="booking-review-text"><small>{label}</small><b>{value}</b></span><button type="button" className="booking-edit" onClick={onEdit} aria-label={`${t("common.edit")} ${label}`}>{t("common.edit")}</button></div>;
}

function PayOption({ icon, label, sub, active, onClick }: { icon: React.ReactNode; label: string; sub?: string; active: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} aria-pressed={active} className={`booking-option ${active ? "on" : ""}`}>
    <span className="apply-tile">{icon}</span><span className="booking-option-text"><b>{label}</b><small>{sub}</small></span><span className={`booking-radio ${active ? "on" : ""}`} aria-hidden="true" />
  </button>;
}

function Row({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><span>{value}</span></div>;
}
