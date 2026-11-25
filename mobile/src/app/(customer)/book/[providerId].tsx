import { CustomerPreparationNotesSection } from "@/ui/customer/CustomerPreparationNotesSection";
import { CustomerPageHeader } from "@/ui/CustomerPageHeader";
import { memberAgeTranslation } from "@shared/familyMemberAge";
import { CustomerBookingWhen } from "@/ui/customer/BookingWhen";
import { bookingScreenPrimaryCtaKey } from "@shared/booking/bookingStepCta";
import { bookingFieldHintForStep, type BookingFieldHint } from "@shared/booking/bookingFieldHints";
import { BookingVisitRequirements } from "@/ui/customer/BookingVisitRequirements";
import { BookingServiceCard } from "@/ui/customer/BookingServiceCard";
import { BookOpen, Clock, UserRound, Star } from "lucide-react-native";
import { Avatar } from "@/ui/ProviderCard";
import { colors, space } from "@/ui/theme";
import { TutoringCapabilityCascade } from "@/ui/customer/TutoringCapabilityCascade";
import {
  capabilityPickFromCapability,
  type CapabilityPickValue,
} from "@shared/tutoring/providerCapabilityCascade";
import { planPostCreatePayment } from "@/lib/bookingPure";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { randomUUID } from "expo-crypto";
import { useTranslation } from "react-i18next";
import {
  useProvider,
  useProviderServices,
  useBookableServiceIds,
  useAddresses,
  useActiveFamilyMembers,
  useApprovedTeachingCapabilities,
  useCustomerEducationProfile,
  useMyProfile,
  useBooking,
} from "@/lib/queries";
import {
  useAvailableSlots,
  useProviderBookingSettings,
  useResolveZone,
  useFixedPackageRate,
  useCreateBooking,
  useCreatePayment,
  useActivePaymentMethods,
  useRequirementsForService,
  useBookingConfig,
  useSaveStudentEducationProfile,
} from "@/lib/bookingQueries";
import { supabase } from "@/lib/supabase";
import { stashPayment, clearPayment, startPaymob } from "@/lib/mobilePayments";
import { buildBookingRequest, buildBookingQuote } from "@shared/booking/bookingRequest";
import {
  BOOKING_SCREENS,
  bookingScreenMissingStep,
  bookingScreenForStep,
} from "@shared/booking/bookingScreens";
import { bookingDisabledReason } from "@shared/booking/disabledReason";
import {
  checkoutAddressOutsideArea,
  checkoutAddressReady,
  checkoutContinueBlocked,
  checkoutEligibilityServiceId,
} from "@shared/booking/checkoutGates";
import {
  bookingSubmissionFingerprint,
  resolveIdempotencyKey,
  type IdempotencyKeyState,
} from "@shared/booking/idempotency";
import {
  BookingError,
  getBookingErrorMessage,
  isSlotStaleBookingError,
} from "@shared/booking/errors";
import {
  canContinueForWhom,
  familyMemberSelectableForBabysitting,
} from "@shared/booking/babysittingRecipient";
import {
  isFixedPackage,
  filterFixedStartSlots,
  packageLabel,
} from "@shared/pricing/servicePackages";
import { isClosedBetaCategorySlug } from "@shared/catalog/closedBetaCategories";
import { resolveStudentEducationProfile } from "@shared/tutoring/studentEducationProfile";
import {
  pickDefaultCapabilityForEducation,
  shouldPersistEducationAfterBookingSuccess,
} from "@shared/tutoring/bookingEducationAutofill";
import { isLessonServiceSlug } from "@shared/tutoring/lessonServices";
import { localized, dateTime } from "@/lib/presentation";
import { Page, QueryState, Field, Choices, moneyTextStyle, ui } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { ApplePayMark, GooglePayMark, PaymentMethodLogos } from "@/ui/PaymentLogos";
import { showApplePayPaymentOption, showGooglePayPaymentOption } from "@/lib/paymobDevice";
import { usePaymobWalletCapabilities } from "@/lib/usePaymobWalletCapabilities";
import {
  PAYMOB_WALLET_APPLE_PAY_METHOD_ID,
  PAYMOB_WALLET_GOOGLE_PAY_METHOD_ID,
  isPaymobWalletUiMethodId,
  paymobChannelForUiMethodId,
  resolveCheckoutPaymentMethod,
  resolvePaymobOnlinePaymentMethod,
} from "@/lib/paymobWalletMethods";
import { FeeDebtBanner } from "@/ui/FeeDebtBanner";
import { useMyFeeDebts } from "@/lib/debtQueries";
import { useSession } from "@/lib/session";
import { BookingInlineForm } from "@/ui/customer/BookingInlineForm";
import { customerMoney as money, customerNumber } from "@/lib/customerFormat";
import { providerRatingSummary } from "@/lib/providerRating";
import { joinUiParts } from "@shared/format/uiJoin";
import { SupervisionModeChoices } from "@/ui/customer/SupervisionModeChoices";
import { CheckoutPromoPicker } from "@/ui/customer/CheckoutPromoPicker";
import { RebookPrefillNoticeList } from "@/ui/customer/RebookPrefillNotice";
import type { RebookPrefillNotice } from "@shared/booking/rebookPrefill";
import { savedAddressMobileUiParts } from "@shared/booking/savedAddressReviewLine";
import type { RebookFormInitial } from "@shared/booking/rebookFormBootstrap";
import { useRebookSeedGuard } from "@/lib/booking/rebookSeedGuard";
import { BookRebookGate } from "@/ui/customer/BookRebookGate";
import {
  requiresSupervisionMode,
  type SupervisionMode,
  supervisionModeProviderLabel,
  isSupervisionMode,
} from "@shared/booking/supervisionMode";
import { normalizeServiceDeliveryMode } from "@shared/online/serviceMode";
import {
  isOnlineRequestStep,
  isOnlineWhenStep,
  onlineLessonBookMissing,
  ONLINE_LESSON_BOOK_STEPS,
} from "@shared/booking/onlineLessonBookSteps";
import { onlineBookingLearnerAgeIssue } from "@shared/online/onlineBookingLearnerAge";
import { memberAgeFromDate } from "@shared/familyMemberAge";
import { FamilyMemberAgeField } from "@/ui/customer/FamilyMemberAgeField";
import { useCancellationPolicy } from "@/lib/caseQueries";
import { cancellationPolicyLine, normalizeCancellationPolicy } from "@/lib/customerCasesPure";
type Slot = { start: Date; end: Date; label: string };
export default function Book() {
  const {
    providerId,
    serviceId: initialService,
    capabilityId: initialCap,
    rebookFrom,
    serviceMode: serviceModeParam,
  } = useLocalSearchParams<{
    providerId: string;
    serviceId?: string;
    capabilityId?: string;
    rebookFrom?: string;
    serviceMode?: string;
  }>();
  const serviceMode = normalizeServiceDeliveryMode(serviceModeParam);
  return (
    <BookRebookGate providerId={providerId} rebookFrom={rebookFrom}>
      {({ mountKey, rebookInitial, rebookNotices }) => (
        <BookForm
          key={mountKey}
          providerId={providerId}
          initialService={initialService}
          initialCap={initialCap}
          rebookFrom={rebookFrom}
          rebookInitial={rebookInitial}
          rebookNotices={rebookNotices}
          serviceMode={serviceMode}
        />
      )}
    </BookRebookGate>
  );
}

function BookForm({
  providerId,
  initialService,
  initialCap,
  rebookFrom,
  rebookInitial,
  rebookNotices: rebookNoticesProp,
  serviceMode,
}: {
  providerId: string;
  initialService?: string;
  initialCap?: string;
  rebookFrom?: string;
  rebookInitial: RebookFormInitial | null;
  rebookNotices: import("@shared/booking/rebookPrefill").RebookPrefillNotice[];
  serviceMode: "in_person" | "online";
}) {
  const isOnlineBooking = serviceMode === "online";
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  // Show the in-person cancellation rule (from the database) before the customer commits.
  const cancellationPolicy = useCancellationPolicy("in_person");
  const policyLine = cancellationPolicyLine(
    normalizeCancellationPolicy(cancellationPolicy.data),
    (amount) => money(amount, lang),
  );
  const locale = lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB";
  const [inlineForm, setInlineForm] = useState<"member" | "address" | null>(null);
  const [editing, setEditing] = useState(false);
  const provider = useProvider(providerId, undefined, serviceMode);
  const servicesQ = useProviderServices(providerId);
  const addresses = useAddresses();
  const members = useActiveFamilyMembers();
  const methods = useActivePaymentMethods();
  const paymobCaps = usePaymobWalletCapabilities();
  const billing = useBookingConfig<{ platform_fee: number; vat_percent: number }>("billing");
  const create = useCreateBooking();
  const createPayment = useCreatePayment();
  const saveEducation = useSaveStudentEducationProfile();
  const savedEducation = useCustomerEducationProfile();
  const profile = useMyProfile();
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!isOnlineBooking) return;
    setRecipient("myself");
  }, [isOnlineBooking]);
  const { guardDefault, touch } = useRebookSeedGuard(rebookInitial?.seededFields);
  const [serviceId, setServiceId] = useState(rebookInitial?.serviceId ?? initialService ?? "");
  const [capId, setCapId] = useState(rebookInitial?.capabilityId ?? initialCap ?? "");
  const [hours, setHours] = useState(rebookInitial?.durationHours ?? 4);
  const [date, setDate] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [slot, setSlot] = useState<Slot | null>(null);
  const [addressId, setAddressId] = useState(rebookInitial?.addressId ?? "");
  const [recipient, setRecipient] = useState(rebookInitial?.forWhom ?? "myself");
  const [supervisionMode, setSupervisionMode] = useState<SupervisionMode | "">(
    rebookInitial?.supervisionMode ?? "",
  );
  const [notes, setNotes] = useState(rebookInitial?.notes ?? "");
  const [methodId, setMethodId] = useState("");
  const [choices, setChoices] = useState<Record<string, "customer" | "provider">>(
    rebookInitial?.requirementChoices ?? {},
  );
  const [applied, setApplied] = useState<{ id: string; discount: number; code: string } | null>(
    null,
  );
  const [error, setError] = useState("");
  const [fieldHint, setFieldHint] = useState<BookingFieldHint | null>(null);
  const [busy, setBusy] = useState(false);
  const [curriculum, setCurriculum] = useState(
    rebookInitial?.education.educationCurriculumId ?? "",
  );
  const [level, setLevel] = useState(rebookInitial?.education.educationLevelId ?? "");
  const [capabilityPick, setCapabilityPick] = useState<CapabilityPickValue>({
    subjectCode: "",
    curriculumId: rebookInitial?.education.educationCurriculumId ?? "",
    levelId: rebookInitial?.education.educationLevelId ?? "",
  });
  const [saveSchool, setSaveSchool] = useState(false);
  const idempotency = useRef<IdempotencyKeyState | null>(null);
  const submitting = useRef(false);
  const userDate = useRef(false);
  const userCap = useRef(rebookInitial?.capabilityUserPicked ?? !!initialCap);
  const rebookNotices = rebookNoticesProp;
  const createdId = useRef<string | null>(null);
  const pinned = (addresses.data ?? []).filter((a) => a.lat != null && a.lng != null);
  const selectedAddress = pinned.find((a) => a.id === addressId);
  const reviewAddressId = addressId || pinned.find((a) => a.is_default)?.id || pinned[0]?.id || "";
  const reviewAddressLine = useMemo(() => {
    const addr = pinned.find((a) => a.id === reviewAddressId);
    return joinUiParts(savedAddressMobileUiParts(addr), lang);
  }, [pinned, reviewAddressId, lang]);
  const zone = useResolveZone(selectedAddress?.lat, selectedAddress?.lng);
  const bookable = useBookableServiceIds(
    providerId,
    isOnlineBooking ? undefined : addressId || undefined,
    serviceMode,
  );
  const services = (servicesQ.data ?? []).filter(
    (s) => isClosedBetaCategorySlug(s.service.category?.slug) && bookable.data?.has(s.service.id),
  );
  const service = services.find((s) => s.service.id === serviceId) ?? services[0];
  const eligibilityServiceId = checkoutEligibilityServiceId(serviceId, service?.service.id);
  const tutoring = service?.service.category?.slug === "tutoring";
  const isLessonService = isLessonServiceSlug(service?.service.slug);
  const babysitting = service?.service.category?.slug === "babysitting";
  const supervisionRequired = requiresSupervisionMode(service?.service.category?.slug);
  const fixed = !tutoring && isFixedPackage(service?.service);
  const caps = useApprovedTeachingCapabilities(providerId, service?.service.id);
  const allCaps = useApprovedTeachingCapabilities(providerId);
  const capability = (caps.data ?? []).find((c) => c.id === capId) ?? null;
  const hasApprovedCapabilities = (caps.data ?? []).length > 0;
  const needsRate = fixed && service?.price_override == null;
  const packageRate = useFixedPackageRate(
    providerId,
    needsRate ? service?.service.id : undefined,
    addressId || null,
  );
  const duration = capability
    ? capability.durationMin
    : fixed
      ? Number(service?.service.duration_min)
      : hours * 60;
  useEffect(() => {
    if (!isOnlineBooking || !tutoring || capId || !(caps.data?.length ?? 0)) return;
    const pick =
      caps.data!.find((c) => c.id === initialCap) ??
      caps.data!.find((c) => c.durationMin === duration) ??
      caps.data![0];
    if (pick) setCapId(pick.id);
  }, [isOnlineBooking, tutoring, capId, caps.data, initialCap, duration]);
  useEffect(() => {
    if (!isOnlineBooking || !initialService || serviceId) return;
    if (services.some((s) => s.service.id === initialService)) setServiceId(initialService);
  }, [isOnlineBooking, initialService, serviceId, services]);
  const settings = useProviderBookingSettings(providerId, {
    serviceId: eligibilityServiceId,
    addressId: isOnlineBooking ? null : addressId || null,
  });
  const slots = useAvailableSlots(providerId, date, duration || 120, {
    serviceId: service?.service.id,
    addressId: isOnlineBooking ? null : addressId || null,
    cairoTime: fixed,
    fixedStartTime: fixed ? service?.service.fixed_start_time : null,
  });
  const available = useMemo(
    () => filterFixedStartSlots(slots.data ?? [], service?.service),
    [slots.data, service?.service],
  );
  const requirements = useRequirementsForService(service?.service.id);
  const required = (requirements.data ?? []).filter((r) => r.required_during_booking);
  const either = required.filter((r) => r.fulfillment_mode === "either");
  const student = resolveStudentEducationProfile({
    forWhom: recipient,
    customerProfile: savedEducation.data,
    customerFullName: profile.data?.full_name,
    familyMembers: members.data ?? [],
  });
  useEffect(() => {
    if (guardDefault("addressId")) return;
    if (!addressId && pinned.length) {
      setAddressId((pinned.find((a) => a.is_default) ?? pinned[0]).id);
    }
  }, [addressId, pinned, guardDefault]);
  useEffect(() => {
    if (!methodId && methods.data?.length)
      setMethodId((methods.data.find((m) => m.is_default) ?? methods.data[0]).id);
  }, [methodId, methods.data]);
  useEffect(() => {
    if (guardDefault("forWhom")) return;
    if (babysitting && recipient === "myself") setRecipient("");
    if (!babysitting && !recipient) setRecipient("myself");
  }, [babysitting, recipient, guardDefault]);

  useEffect(() => {
    if (!capability) return;
    setCapabilityPick(capabilityPickFromCapability(capability));
  }, [capability?.id]);

  useEffect(() => {
    if (!tutoring || isLessonService) return;
    if (guardDefault("education")) return;
    const nextCurriculum = student.educationCurriculumId || "";
    const nextLevel = student.educationLevelId || "";
    setCurriculum(nextCurriculum);
    setLevel(nextLevel);
    setCapabilityPick((pick) => ({
      ...pick,
      curriculumId: nextCurriculum,
      levelId: nextLevel,
    }));
    userCap.current = !!initialCap;
  }, [
    tutoring,
    isLessonService,
    recipient,
    student.educationCurriculumId,
    student.educationLevelId,
    initialCap,
    guardDefault,
  ]);
  useEffect(() => {
    if (guardDefault("capabilityId")) return;
    if (tutoring && !isLessonService && !userCap.current)
      setCapId(
        pickDefaultCapabilityForEducation(
          caps.data ?? [],
          service?.service.id,
          curriculum || null,
          level || null,
        )?.id || "",
      );
  }, [tutoring, isLessonService, caps.data, service?.service.id, curriculum, level, guardDefault]);
  useEffect(() => {
    setSlot(null);
    setApplied(null);
  }, [service?.service.id, capId, hours, addressId]);
  useEffect(() => {
    if (guardDefault("supervisionMode")) return;
    setSupervisionMode("");
  }, [service?.service.id, guardDefault]);
  useEffect(() => {
    if (fixed && service?.service.fixed_start_time)
      setSlot(!slots.isFetching && !slots.isError ? (available[0] ?? null) : null);
  }, [fixed, service?.service.fixed_start_time, slots.isFetching, slots.isError, available]);
  useEffect(() => {
    if (step !== 1 || userDate.current || slots.isFetching || slots.isError || available.length)
      return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const n = Math.round((+date - +today) / 86400000);
    if (n + 1 < Math.min(14, settings.data?.max_advance_days ?? 12)) {
      setDate(new Date(+date + 86400000));
      setSlot(null);
    }
  }, [
    step,
    date,
    slots.isFetching,
    slots.isError,
    available.length,
    settings.data?.max_advance_days,
  ]);
  const currentSlot =
    slot && available.some((s) => +s.start === +slot.start && +s.end === +slot.end) ? slot : null;
  const { session } = useSession();
  const feeDebts = useMyFeeDebts(session?.user.id);
  const quote = buildBookingQuote({
    service: service?.service,
    rate: Number(
      service?.price_override ?? (needsRate ? packageRate.data : provider.data?.hourly_rate),
    ),
    hours: duration / 60,
    capability,
    fee: billing.data?.platform_fee ?? 25,
    vatPercent: billing.data?.vat_percent ?? 14,
    requirements: required,
    requirementChoices: choices,
    travelFee: isOnlineBooking ? 0 : Number(zone.data?.travel_fee ?? 0),
    promoDiscount: applied?.discount ?? 0,
  });
  // Earlier unpaid cancellation fees are added to this booking by the server.
  const carriedFees = feeDebts.data?.total ?? 0;
  const amountDue = quote.total + carriedFees;
  const recipientReady = canContinueForWhom({
    isBabysitting: babysitting,
    forWhom: recipient,
    members: members.data ?? [],
    startAt: currentSlot?.start ?? null,
  });
  const onlineLearnerAgeIssue = isOnlineBooking
    ? onlineBookingLearnerAgeIssue(
        recipient,
        profile.data?.date_of_birth ?? null,
        members.data ?? [],
      )
    : null;
  const onlineRecipientReady = recipientReady && !onlineLearnerAgeIssue;
  const supervisionReady = !supervisionRequired || !!supervisionMode;
  const addressReady = checkoutAddressReady({
    addressId: isOnlineBooking ? null : addressId || null,
    hasPinnedAddress: !!selectedAddress,
    bookable,
    serviceId: eligibilityServiceId,
  });
  const addressOutside = checkoutAddressOutsideArea({
    addressId: isOnlineBooking ? null : addressId || null,
    hasPinnedAddress: !!selectedAddress,
    bookable,
    serviceId: eligibilityServiceId,
  });
  const checkoutMethods = useMemo(
    () =>
      isOnlineBooking
        ? (methods.data ?? []).filter((m) => m.method_type !== "cash")
        : (methods.data ?? []),
    [isOnlineBooking, methods.data],
  );
  const paymobOnline = resolvePaymobOnlinePaymentMethod(checkoutMethods);
  const showApplePay =
    !!paymobOnline && showApplePayPaymentOption(!!paymobCaps.data?.applePay);
  const showGooglePay =
    !!paymobOnline && showGooglePayPaymentOption(!!paymobCaps.data?.googlePay);
  const paymentMethodReady =
    !!methodId &&
    (isPaymobWalletUiMethodId(methodId)
      ? !!paymobOnline
      : !!methods.data?.some((m) => m.id === methodId));
  const missing = isOnlineBooking
    ? onlineLessonBookMissing({
        service: !!service,
        slot: !!currentSlot && !slots.isFetching,
        tutoring,
        capability: !!capability,
        recipient: onlineRecipientReady,
      })
    : bookingScreenMissingStep(BOOKING_SCREENS[step], {
        service: !!service,
        tutoring,
        capability: !!capability,
        slot: !!currentSlot && !slots.isFetching,
        address: addressReady,
        recipient: onlineRecipientReady,
        supervisionRequired,
        supervision: supervisionReady,
        requirements: requirements.isSuccess && either.every((r) => !!choices[r.id]),
        payment: paymentMethodReady,
      });
  const blocked = checkoutContinueBlocked({
    servicesError: servicesQ.isError,
    bookable,
    settings,
    billingError: billing.isError,
    quoteTotal: quote.total,
    hasService: !!service,
    needsRate,
    packageRate,
    capsError: tutoring && caps.isError,
    addressId: isOnlineBooking ? null : addressId || null,
    serviceId: eligibilityServiceId,
  });
  const loading =
    servicesQ.isLoading ||
    bookable.isLoading ||
    settings.isLoading ||
    billing.isLoading ||
    (needsRate && packageRate.isLoading);
  const reason = bookingDisabledReason({
    step: missing ?? "summary",
    allowed: !missing,
    submitting: busy,
    loading,
    error: !!blocked,
    hasDate: true,
    hasSlots: available.length > 0,
    hasAddress: isOnlineBooking || !!addressId,
    addressOutside,
    hasRecipient: recipientReady,
    hasSupervision: supervisionReady,
    supervisionRequired,
    lessonService: isLessonService,
  });
  async function submit() {
    if (submitting.current || missing || blocked || !service || !currentSlot) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      if (createdId.current) {
        router.replace({ pathname: "/booking/[id]", params: { id: createdId.current } });
        return;
      }
      const { data: clashes, error: clashError } = await supabase.rpc("provider_busy_ranges", {
        p_provider_id: providerId,
        p_from: currentSlot.start.toISOString(),
        p_to: currentSlot.end.toISOString(),
      });
      if (clashError) throw clashError;
      if (clashes?.length) {
        setSlot(null);
        setStep(1);
        setError(t("bookFlow.slotTaken"));
        await slots.refetch();
        return;
      }
      // The server adds unpaid fees when it creates the booking: make sure the total shown
      // is still right before confirming.
      const fees = await feeDebts.refetch();
      if (fees.isError || !fees.data) {
        setError(t("bookFlow.feesCheckFailed"));
        return;
      }
      if (fees.data.total !== carriedFees) {
        setError(t("bookFlow.feesChanged"));
        return;
      }
      const payload = buildBookingRequest({
        providerId,
        serviceId: service.service.id,
        addressId: isOnlineBooking ? null : addressId,
        serviceMode,
        forWhom: recipient,
        start: currentSlot.start,
        end: currentSlot.end,
        promoStatus: applied ? "applied" : "idle",
        appliedPromoId: applied?.id ?? null,
        notes,
        eitherRequirements: either,
        requirementChoices: choices,
        selectedCapability: capability,
        supervisionMode:
          supervisionRequired && isSupervisionMode(supervisionMode) ? supervisionMode : null,
      });
      idempotency.current = resolveIdempotencyKey(
        idempotency.current,
        bookingSubmissionFingerprint(payload),
        randomUUID,
      );
      // Resolve the payment method before creating the booking: it can disappear after a refetch.
      const checkoutMethod = isOnlineBooking
        ? null
        : resolveCheckoutPaymentMethod(methodId, methods.data, paymobOnline);
      if (!isOnlineBooking && !checkoutMethod) {
        setError(t("bookFlow.paymentMethodUnavailable"));
        return;
      }
      const booking = await create.mutateAsync({
        ...payload,
        idempotency_key: idempotency.current.key,
      });
      createdId.current = booking.id;
      if (checkoutMethod) {
        const walletChannel = paymobChannelForUiMethodId(methodId);
        const method = checkoutMethod;
        const paymobChannel = walletChannel ?? "card";
        await stashPayment(booking.id, {
          paymentMethodId: method.id,
          methodType: method.method_type,
          ...(paymobChannel !== "card" ? { paymobChannel } : {}),
        });
      }
      let educationWarning = false;
      if (
        shouldPersistEducationAfterBookingSuccess({
          bookingSucceeded: true,
          isTutoring: tutoring,
          saveForNextTime: saveSchool,
          draft: { educationCurriculumId: curriculum || null, educationLevelId: level || null },
          saved: student,
        })
      ) {
        try {
          await saveEducation.save({
            forWhom: recipient,
            education_curriculum_id: curriculum || null,
            education_level_id: level || null,
          });
        } catch {
          educationWarning = true;
        }
      }
      if (checkoutMethod) {
        const walletChannel = paymobChannelForUiMethodId(methodId);
        const method = checkoutMethod;
        const paymobChannel = walletChannel ?? "card";
        const paymentPlan = planPostCreatePayment(booking, method);
        if (paymentPlan.action === "create_now") {
          try {
            const payment = await createPayment.mutateAsync({
              bookingId: booking.id,
              paymentMethodId: method.id,
              methodType: method.method_type,
            });
            await clearPayment(booking.id);
            if (method.method_type === "online") {
              await startPaymob(booking.id, payment.id, paymobChannel);
            }
          } catch {
            /* Booking is already created; detail recovers payment or offers checkout retry. */
          }
        }
      }
      router.replace({
        pathname: "/booking/[id]",
        params: { id: booking.id, created: "1", educationWarning: educationWarning ? "1" : "0" },
      });
    } catch (e) {
      if (createdId.current) {
        router.replace({ pathname: "/booking/[id]", params: { id: createdId.current } });
        return;
      }
      setError(getBookingErrorMessage(e, (k) => t(k)));
      if (e instanceof BookingError && isSlotStaleBookingError(e.code)) {
        setSlot(null);
        setStep(1);
        await slots.refetch();
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  const recipientUI = (
    <View style={{ gap: 12 }}>
      <Choices
        label={t("bookFlow.forWhomTitle")}
        value={recipient}
        onChange={(v) => {
          touch("forWhom");
          setRecipient(v);
        }}
        options={[
          ...(!babysitting ? [{ value: "myself", label: t("bookFlow.forWhomMyself") }] : []),
          ...(members.data ?? [])
            .filter(
              (m) =>
                (!isOnlineBooking ||
                  (memberAgeFromDate(m.date_of_birth)?.years ?? 0) >= 12) &&
                (!babysitting ||
                  familyMemberSelectableForBabysitting(m, currentSlot?.start ?? null).ok),
            )
            .map((m) => ({
              value: m.id,
              label: joinUiParts(
                [
                  m.full_name,
                  t(memberAgeTranslation(m.date_of_birth).key, {
                    count: memberAgeTranslation(m.date_of_birth).count,
                  }),
                ],
                lang,
              ),
            })),
        ]}
      />
      <QueryState query={members} empty={babysitting && !members.data?.length} />
      <Button
        variant="secondary"
        label={t("customerBooking.addMember")}
        onPress={() => setInlineForm("member")}
      />
      {supervisionRequired && (
        <SupervisionModeChoices
          value={supervisionMode}
          onChange={(mode) => {
            touch("supervisionMode");
            setSupervisionMode(mode);
          }}
        />
      )}
      {isOnlineBooking && recipient === "myself" && !profile.data?.date_of_birth ? (
        <View style={{ gap: 8 }}>
          <Text tone="muted">{t("bookFlow.onlineBirthDatePrompt")}</Text>
          <FamilyMemberAgeField
            value={profile.data?.date_of_birth ?? ""}
            relationship="friend"
            onChange={(dob) => {
              const userId = session?.user.id;
              if (!userId) return;
              void supabase
                .from("profiles")
                .update({ date_of_birth: dob })
                .eq("id", userId)
                .then(({ error }) => {
                  if (error) setError(t("common.somethingWentWrong"));
                  else void profile.refetch();
                });
            }}
          />
        </View>
      ) : null}
      {isOnlineBooking && onlineLearnerAgeIssue === "age_minimum" ? (
        <Text tone="danger">{t("bookFlow.errors.ONLINE_AGE_MINIMUM")}</Text>
      ) : null}
    </View>
  );
  return (
    <Page
      header={
        <CustomerPageHeader
          title={t(`customerBooking.titles.${BOOKING_SCREENS[step]}`, {
            name: provider.data?.profile.full_name?.split(" ")[0] || "",
          })}
          subtitle={t("customerRound2.step", {
            step: String(step + 1),
            total: isOnlineBooking ? String(ONLINE_LESSON_BOOK_STEPS) : "4",
          })}
          onBack={() => {
            if (busy) return;
            if (step > 0) setStep(step - 1);
            else router.back();
          }}
        />
      }
      title={t(`customerBooking.titles.${BOOKING_SCREENS[step]}`, {
        name: provider.data?.profile.full_name?.split(" ")[0] || "",
      })}
      footer={
        <>
          <View style={ui.priceRow}>
            <Text tone="muted" weight="bold">
              {t("mobile.price.total")}
            </Text>
            <Text size="xxl" weight="heavy" tone="brand" style={moneyTextStyle(lang)}>
              {loading
                ? t("common.loading")
                : tutoring && !capability
                  ? t("customerBooking.tutoringPrice")
                  : money(amountDue, lang)}
            </Text>
          </View>
          {reason && !busy ? (
            <Text size="sm" tone="muted" style={{ textAlign: "center" }}>
              {t(reason)}
            </Text>
          ) : null}
          <View style={{ flexDirection: "row", gap: space.md, alignItems: "center" }}>
            <View style={{ flex: 1 }}>
              <Button
                label={t(
                  isOnlineRequestStep(step, isOnlineBooking)
                    ? "onlineLesson.requestLesson"
                    : step === 3
                      ? "mobileBooking.confirmBooking"
                      : bookingScreenPrimaryCtaKey(BOOKING_SCREENS[step], editing),
                )}
                loading={busy}
                disabled={
                  busy ||
                  loading ||
                  (tutoring && step === 0 && (!hasApprovedCapabilities || caps.isLoading))
                }
                onPress={() => {
                  setError("");
                  if (missing || blocked) {
                    if (missing) {
                      const hint = bookingFieldHintForStep(missing, tutoring);
                      if (hint) {
                        setFieldHint(hint);
                        const target = BOOKING_SCREENS.indexOf(hint.screen);
                        if (target >= 0) setStep(target);
                      }
                    }
                    return;
                  }
                  if (isOnlineRequestStep(step, isOnlineBooking) || step === 3) void submit();
                  else {
                    setFieldHint(null);
                    const last = isOnlineBooking ? ONLINE_LESSON_BOOK_STEPS - 1 : 3;
                    setStep(editing ? last : Math.min(step + 1, last));
                    setEditing(false);
                  }
                }}
              />
            </View>
          </View>
        </>
      }
      queries={[
        provider,
        servicesQ,
        addresses,
        bookable,
        settings,
        slots,
        requirements,
        methods,
        billing,
      ]}
    >
      <FeeDebtBanner />
      <QueryState query={provider} skeleton="detail" />
      <QueryState query={servicesQ} />
      <QueryState query={bookable} />
      <QueryState query={settings} />
      <QueryState query={billing} />
      {needsRate && <QueryState query={packageRate} />}
      <RebookPrefillNoticeList notices={rebookNotices} />
      {!isOnlineBooking && !pinned.length && !addresses.isLoading && (
        <>
          <Text>{t("customerHome.addressHint")}</Text>
          <Button label={t("addresses.addAddress")} onPress={() => setInlineForm("address")} />
        </>
      )}
      {step === 0 && !isOnlineBooking && (
        <>
          <View
            nativeID="booking-services"
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              padding: 12,
              borderRadius: 20,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Avatar raw={provider.data?.profile.avatar_url} size={48} round />
            <View style={{ flex: 1, gap: 4 }}>
              <Text weight="heavy">{provider.data?.profile.full_name}</Text>
              <Text size="xs" tone="muted">
                <Star size={12} color={colors.warning} />{" "}
                {providerRatingSummary(
                  Number(provider.data?.ratings?.rating_avg ?? 0),
                  t("customerBooking.jobs", {
                    count: provider.data?.ratings?.rating_count ?? 0,
                    countLabel: String(provider.data?.ratings?.rating_count ?? 0),
                  }),
                  lang,
                )}
              </Text>
            </View>
          </View>
          <Text weight="bold">{t("search2.service")}</Text>
          {fieldHint?.focusId === "booking-services" ? (
            <Text tone="danger">{t(fieldHint.messageKey)}</Text>
          ) : null}
          {services.map((s) => (
            <BookingServiceCard
              key={s.service.id}
              selected={s.service.id === service?.service.id}
              title={localized(s.service, lang)}
              subtitle={(() => {
                // Same subtitles as web book.$providerId ServiceCard.
                if (isFixedPackage(s.service))
                  return t(packageLabel(s.service).key, packageLabel(s.service).values);
                if (s.service.category?.slug === "tutoring") {
                  const prices = (allCaps.data ?? [])
                    .filter((c) => c.serviceId === s.service.id)
                    .map((c) => c.price);
                  return prices.length
                    ? t("customerBooking.tutoringFrom", {
                        price: customerNumber(Math.min(...prices), lang),
                      })
                    : t("customerBooking.tutoringPrice");
                }
                return `${customerNumber(Number(s.price_override ?? provider.data?.hourly_rate ?? 0), lang)} ${t("pricePicker.hourUnit")}`;
              })()}
              trailing={
                isFixedPackage(s.service) && s.price_override != null
                  ? money(Number(s.price_override), lang)
                  : undefined
              }
              icon={
                s.service.category?.slug === "tutoring" ? (
                  <BookOpen size={22} color={colors.brand} />
                ) : isFixedPackage(s.service) ? (
                  <Clock size={22} color={colors.brand} />
                ) : (
                  <UserRound size={22} color={colors.brand} />
                )
              }
              onPress={() => {
                setServiceId(s.service.id);
                setCapId("");
                userCap.current = false;
                setChoices({});
              }}
            >
              {!isFixedPackage(s.service) && s.service.category?.slug !== "tutoring" ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <Button
                    variant="secondary"
                    label={t("mobileBooking.less")}
                    disabled={hours <= 2}
                    onPress={() => setHours(Math.max(2, hours - 2))}
                  />
                  <Text weight="heavy" style={{ flex: 1, textAlign: "center" }}>
                    {t("customerBooking.duration", { hours: String(hours) })}
                  </Text>
                  <Button
                    variant="secondary"
                    label={t("mobileBooking.more")}
                    disabled={hours >= 8}
                    onPress={() => setHours(Math.min(8, hours + 2))}
                  />
                </View>
              ) : null}
            </BookingServiceCard>
          ))}
          {!services.length && !loading && <Text>{t("bookFlow.unavailableBody")}</Text>}
          {tutoring ? (
            <>
              {recipientUI}
              <QueryState query={caps} empty={!hasApprovedCapabilities} />
              {service?.service.id ? (
                <TutoringCapabilityCascade
                  serviceId={service.service.id}
                  serviceSlug={service.service.slug}
                  capabilities={caps.data ?? []}
                  pick={capabilityPick}
                  capabilityId={capId}
                  onPickChange={(next, source) => {
                    setCapabilityPick(next);
                    setCurriculum(next.curriculumId);
                    setLevel(next.levelId);
                    if (source !== "normalize") {
                      userCap.current = true;
                      setCapId("");
                    }
                  }}
                  onCapabilityChange={(id) => {
                    userCap.current = true;
                    setCapId(id);
                  }}
                />
              ) : null}
              {!isLessonService ? (
                <Choices
                  layout="cards"
                  label={t("mobileBooking.saveSchool")}
                  value={saveSchool ? "yes" : "no"}
                  onChange={(v) => setSaveSchool(v === "yes")}
                  options={[
                    { value: "yes", label: t("mobileBooking.yes") },
                    { value: "no", label: t("mobileBooking.no") },
                  ]}
                />
              ) : null}
            </>
          ) : fixed ? (
            <Text>
              {t(packageLabel(service!.service).key, packageLabel(service!.service).values)}
            </Text>
          ) : null}
        </>
      )}
      {isOnlineWhenStep(step, isOnlineBooking) && (
        <>
          {isOnlineBooking && service ? (
            <Text weight="bold">
              {localized(service.service, lang)} · {provider.data?.profile.full_name?.split(" ")[0]}
            </Text>
          ) : null}
          {!isOnlineBooking ? (
            <BookingVisitRequirements
              categorySlug={service?.service.category?.slug}
              requirements={requirements.data ?? []}
            />
          ) : null}
          {fieldHint?.focusId === "booking-schedule" ? (
            <Text tone="danger">{t(fieldHint.messageKey)}</Text>
          ) : null}
          <View nativeID="booking-schedule">
            <CustomerBookingWhen
              providerId={providerId}
              serviceId={service?.service.id ?? ""}
              addressId={isOnlineBooking ? "" : addressId}
              service={service?.service ?? {}}
              durationMinutes={duration || 120}
              maxAdvanceDays={settings.data?.max_advance_days ?? 12}
              cairoTime={fixed}
              locale={locale}
              date={date}
              selected={currentSlot}
              slots={available}
              loading={slots.isLoading || slots.isFetching}
              error={slots.isError}
              onRetry={() => slots.refetch()}
              onDateChange={(day) => {
                userDate.current = true;
                setDate(day);
                setSlot(null);
              }}
              onTimeChange={setSlot}
            />
          </View>
          {isOnlineBooking ? (
            <Field
              label={t("onlineLesson.noteOptional")}
              value={notes}
              onChangeText={setNotes}
              multiline
            />
          ) : null}
        </>
      )}
      {step === 2 && (
        <>
          {!isOnlineBooking ? (
            <>
              <QueryState query={addresses} empty={!pinned.length} />
              {fieldHint?.focusId === "booking-addresses" ? (
                <Text tone="danger">{t(fieldHint.messageKey)}</Text>
              ) : null}
              <View nativeID="booking-addresses">
                <Choices
                  layout="cards"
                  label={t("bookingUx.chooseAddress")}
                  value={addressId}
                  onChange={(v) => {
                    touch("addressId");
                    setAddressId(v);
                    setSlot(null);
                  }}
                  options={pinned.map((a) => ({
                    value: a.id,
                    label: joinUiParts(
                      [a.area, a.street, a.building].filter(Boolean) as string[],
                      lang,
                    ),
                  }))}
                />
                <Button
                  variant="secondary"
                  label={t("addresses.addAddress")}
                  onPress={() => setInlineForm("address")}
                />
              </View>
              <QueryState query={bookable} empty={addressOutside} emptyKey="bookingUx.outsideArea" />
            </>
          ) : null}
          {!tutoring && recipientUI}
          <QueryState query={requirements} />
          {required.map((r) => (
            <View key={r.id} style={ui.card}>
              <Text>{lang === "ar" ? r.name_ar : r.name_en}</Text>
              {r.fulfillment_mode === "either" ? (
                <Choices
                  layout="cards"
                  label={t("bookingUx.chooseRequirements")}
                  value={choices[r.id] || ""}
                  onChange={(v) =>
                    setChoices((c) => ({ ...c, [r.id]: v as "customer" | "provider" }))
                  }
                  options={[
                    { value: "customer", label: t("mobileBooking.customerProvides") },
                    {
                      value: "provider",
                      label: joinUiParts(
                        [t("mobileBooking.providerProvides"), money(r.provider_extra_fee, lang)],
                        lang,
                      ),
                    },
                  ]}
                />
              ) : (
                <Text>
                  {t(
                    r.fulfillment_mode === "provider"
                      ? "mobileBooking.providerProvides"
                      : "mobileBooking.customerProvides",
                  )}
                </Text>
              )}
            </View>
          ))}
          <Field label={t("setup.notes")} value={notes} onChangeText={setNotes} multiline />
        </>
      )}
      {(step === 3 || isOnlineRequestStep(step, isOnlineBooking)) && (
        <>
          {isOnlineBooking ? (
            <Text size="sm" tone="muted">
              {t("onlineLesson.requestHint")}
            </Text>
          ) : null}
          <View>
            {[
              {
                label: t("bookFlow.stepName.service"),
                value: joinUiParts(
                  [
                    localized(service?.service, lang),
                    capability
                      ? t("bookFlow.sessionLine", { minutes: String(capability.durationMin) })
                      : fixed
                        ? t(
                            packageLabel(service!.service).key,
                            packageLabel(service!.service).values,
                          )
                        : t("customerBooking.duration", { hours: String(hours) }),
                  ],
                  lang,
                ),
                step: 0,
              },
              {
                label: t("bookFlow.rowDate"),
                value: currentSlot
                  ? dateTime(currentSlot.start.toISOString(), lang)
                  : t("bookFlow.dash"),
                step: 1,
              },
              ...(isOnlineBooking
                ? []
                : [
                    {
                      label: t("bookFlow.rowAddress"),
                      value: reviewAddressLine,
                      step: 2,
                    },
                  ]),
              {
                label: t("customerBooking.recipient"),
                value:
                  recipient === "myself"
                    ? t("bookFlow.forWhomMyself")
                    : members.data?.find((m) => m.id === recipient)?.full_name,
                step: tutoring ? 0 : 2,
              },
              ...(supervisionRequired && isSupervisionMode(supervisionMode)
                ? [
                    {
                      label: t("bookFlow.supervision.label"),
                      value: supervisionModeProviderLabel(supervisionMode, t) ?? "",
                      step: tutoring ? 0 : 2,
                    },
                  ]
                : []),
              ...(notes ? [{ label: t("bookFlow.rowNotes"), value: notes, step: 2 }] : []),
            ].map((row, index, rows) => (
              <View
                key={row.label}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  paddingVertical: 10,
                  borderBottomWidth: index === rows.length - 1 ? 0 : 1,
                  borderBottomColor: colors.border,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text size="xs" tone="muted">
                    {row.label}
                  </Text>
                  <Text weight="bold">{row.value}</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t("common.edit")} ${row.label}`}
                  onPress={() => {
                    setEditing(true);
                    setStep(row.step);
                  }}
                  style={{ minWidth: 44, minHeight: 44, justifyContent: "center" }}
                >
                  <Text size="sm" tone="brand" weight="bold">
                    {t("common.edit")}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
          <CustomerPreparationNotesSection notes={service?.preparation_notes} />
          <View
            style={{
              borderRadius: 16,
              backgroundColor: colors.surface2,
              paddingHorizontal: 14,
              paddingVertical: 12,
              gap: 6,
            }}
          >
            {Object.entries({
              subtotal: quote.subtotal,
              platform_fee: quote.fee,
              vat: quote.vat,
              extras_total: quote.extrasTotal,
              travel_fee: quote.travelFee,
              discount: applied?.discount ?? 0,
              carried_fees: carriedFees,
              total: amountDue,
            })
              .filter(
                ([key, v]) =>
                  !["extras_total", "travel_fee", "discount", "carried_fees"].includes(key) ||
                  Number(v) > 0,
              )
              .map(([key, v]) => (
                <View
                  key={key}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    ...(key === "total"
                      ? { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 6 }
                      : {}),
                  }}
                >
                  <Text
                    style={{ flex: 1 }}
                    weight={key === "total" ? "heavy" : "regular"}
                    tone={key === "total" ? "default" : "muted"}
                  >
                    {key === "subtotal"
                      ? capability
                        ? t("bookFlow.sessionLine", { minutes: String(capability.durationMin) })
                        : fixed
                          ? t("packages.fixedPrice")
                          : t("customerBooking.rateLine", {
                              rate: money(quote.subtotal / (duration / 60), lang),
                              hours: String(hours),
                            })
                      : t(
                          {
                            platform_fee: "bookFlow.serviceFee",
                            vat: "customerRound2.vat",
                            extras_total: "bookFlow.extrasTotal",
                            travel_fee: "bookFlow.travelFee",
                            discount: "bookFlow.promoDiscount",
                            carried_fees: "bookFlow.carriedFees",
                            total: "bookFlow.total",
                          }[key] ?? `mobile.price.${key}`,
                        )}
                  </Text>
                  <Text
                    size={key === "total" ? "lg" : "md"}
                    weight={key === "total" ? "heavy" : "regular"}
                    tone="default"
                    style={moneyTextStyle(lang)}
                  >
                    {key === "discount" ? "-" : ""}
                    {money(v, lang)}
                  </Text>
                </View>
              ))}
          </View>
          {service ? (
            <CheckoutPromoPicker
              serviceId={service.service.id}
              subtotal={quote.subtotal}
              applied={applied}
              onApplied={setApplied}
            />
          ) : null}
          {isOnlineBooking ? (
            <>
              <Text size="sm" tone="muted">
                {t("wallet.refundDisclosure")}
              </Text>
              <Text size="sm" tone="muted">
                {t("onlineLesson.requestHint")}
              </Text>
            </>
          ) : null}
          {!isOnlineBooking && policyLine ? (
            <Text size="sm" weight="bold" accessibilityRole="text">
              {t(policyLine.key, policyLine.params)}
            </Text>
          ) : null}
          {!isOnlineBooking ? <QueryState query={methods} empty={!methods.data?.length} /> : null}
          {!isOnlineBooking ? (
          <Choices
            layout="cards"
            label={t("payment.title")}
            value={methodId}
            onChange={setMethodId}
            options={[
              ...checkoutMethods.map((m) => ({
                value: m.id,
                label: localized(m, lang),
                adornment: <PaymentMethodLogos code={m.code} type={m.method_type} />,
              })),
              ...(showApplePay
                ? [
                    {
                      value: PAYMOB_WALLET_APPLE_PAY_METHOD_ID,
                      label: t("payment.applePayLabel"),
                      adornment: <ApplePayMark height={16} />,
                    },
                  ]
                : []),
              ...(showGooglePay
                ? [
                    {
                      value: PAYMOB_WALLET_GOOGLE_PAY_METHOD_ID,
                      label: t("payment.googlePayLabel"),
                      adornment: <GooglePayMark height={16} />,
                    },
                  ]
                : []),
            ]}
          />
          ) : null}
        </>
      )}
      {error && <Text tone="danger">{error}</Text>}
      {blocked && !loading && <Text>{t("bookFlow.unavailableBody")}</Text>}

      {missing && step > 0 && (
        <Button
          variant="secondary"
          label={t("mobileBooking.editChoices")}
          onPress={() => setStep(BOOKING_SCREENS.indexOf(bookingScreenForStep(missing, tutoring)))}
        />
      )}
      <BookingInlineForm
        kind={inlineForm}
        onClose={() => setInlineForm(null)}
        onSaved={(id) => {
          if (inlineForm === "member") {
            touch("forWhom");
            setRecipient(id);
          } else {
            setAddressId(id);
            setSlot(null);
          }
          setInlineForm(null);
        }}
      />
    </Page>
  );
}
