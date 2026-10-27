import { CustomerPageHeader } from "@/ui/CustomerPageHeader";
import { CustomerBookingWhen } from "@/ui/customer/BookingWhen";
import { BookingServiceCard } from "@/ui/customer/BookingServiceCard";
import { BookOpen, Clock, UserRound } from "lucide-react-native";
import { Avatar } from "@/ui/ProviderCard";
import { colors } from "@/ui/theme";
import { BookingEducation } from "@/ui/BookingEducation";
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
  validatePromoCode,
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
import { localized, money, dateTime } from "@/lib/presentation";
import { Page, QueryState, Field, Choices, ui } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { PaymentLogos } from "@/ui/PaymentLogos";

type Slot = { start: Date; end: Date; label: string };
export default function Book() {
  const {
    providerId,
    serviceId: initialService,
    capabilityId: initialCap,
  } = useLocalSearchParams<{ providerId: string; serviceId?: string; capabilityId?: string }>();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const locale = lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB";
  const [promoOpen, setPromoOpen] = useState(false);
  const provider = useProvider(providerId);
  const servicesQ = useProviderServices(providerId);
  const addresses = useAddresses();
  const members = useActiveFamilyMembers();
  const methods = useActivePaymentMethods();
  const billing = useBookingConfig<{ platform_fee: number; vat_percent: number }>("billing");
  const create = useCreateBooking();
  const createPayment = useCreatePayment();
  const saveEducation = useSaveStudentEducationProfile();
  const savedEducation = useCustomerEducationProfile();
  const profile = useMyProfile();
  const [step, setStep] = useState(0);
  const [serviceId, setServiceId] = useState(initialService || "");
  const [capId, setCapId] = useState(initialCap || "");
  const [hours, setHours] = useState(4);
  const [date, setDate] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [slot, setSlot] = useState<Slot | null>(null);
  const [addressId, setAddressId] = useState("");
  const [recipient, setRecipient] = useState("myself");
  const [notes, setNotes] = useState("");
  const [methodId, setMethodId] = useState("");
  const [choices, setChoices] = useState<Record<string, "customer" | "provider">>({});
  const [promo, setPromo] = useState("");
  const [applied, setApplied] = useState<{ id: string; discount: number } | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [curriculum, setCurriculum] = useState("");
  const [level, setLevel] = useState("");
  const [saveSchool, setSaveSchool] = useState(false);
  const idempotency = useRef<IdempotencyKeyState | null>(null);
  const submitting = useRef(false);
  const userDate = useRef(false);
  const userCap = useRef(!!initialCap);
  const createdId = useRef<string | null>(null);
  const pinned = (addresses.data ?? []).filter((a) => a.lat != null && a.lng != null);
  const selectedAddress = pinned.find((a) => a.id === addressId);
  const zone = useResolveZone(selectedAddress?.lat, selectedAddress?.lng);
  const bookable = useBookableServiceIds(providerId, addressId || undefined);
  const services = (servicesQ.data ?? []).filter(
    (s) => isClosedBetaCategorySlug(s.service.category?.slug) && bookable.data?.has(s.service.id),
  );
  const service = services.find((s) => s.service.id === serviceId) ?? services[0];
  const tutoring = service?.service.category?.slug === "tutoring";
  const babysitting = service?.service.category?.slug === "babysitting";
  const fixed = !tutoring && isFixedPackage(service?.service);
  const caps = useApprovedTeachingCapabilities(providerId, service?.service.id);
  const capability = (caps.data ?? []).find((c) => c.id === capId) ?? null;
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
  const settings = useProviderBookingSettings(providerId, {
    serviceId: service?.service.id,
    addressId: addressId || null,
  });
  const slots = useAvailableSlots(providerId, date, duration || 120, {
    serviceId: service?.service.id,
    addressId: addressId || null,
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
    if (!addressId && pinned.length)
      setAddressId((pinned.find((a) => a.is_default) ?? pinned[0]).id);
  }, [addressId, pinned]);
  useEffect(() => {
    if (!methodId && methods.data?.length)
      setMethodId((methods.data.find((m) => m.is_default) ?? methods.data[0]).id);
  }, [methodId, methods.data]);
  useEffect(() => {
    if (babysitting && recipient === "myself") setRecipient("");
    if (!babysitting && !recipient) setRecipient("myself");
  }, [babysitting, recipient]);
  useEffect(() => {
    if (!tutoring) return;
    setCurriculum(student.educationCurriculumId || "");
    setLevel(student.educationLevelId || "");
    userCap.current = !!initialCap;
  }, [tutoring, recipient, student.educationCurriculumId, student.educationLevelId, initialCap]);
  useEffect(() => {
    if (tutoring && !userCap.current)
      setCapId(
        pickDefaultCapabilityForEducation(
          caps.data ?? [],
          service?.service.id,
          curriculum || null,
          level || null,
        )?.id || "",
      );
  }, [tutoring, caps.data, service?.service.id, curriculum, level]);
  useEffect(() => {
    setSlot(null);
    setApplied(null);
  }, [service?.service.id, capId, hours, addressId]);
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
    travelFee: Number(zone.data?.travel_fee ?? 0),
    promoDiscount: applied?.discount ?? 0,
  });
  const missing = bookingScreenMissingStep(BOOKING_SCREENS[step], {
    service: !!service,
    tutoring,
    capability: !!capability,
    slot: !!currentSlot && !slots.isFetching,
    address: !!selectedAddress && !!zone.data && !zone.isFetching,
    recipient: canContinueForWhom({
      isBabysitting: babysitting,
      forWhom: recipient,
      members: members.data ?? [],
      startAt: currentSlot?.start ?? null,
    }),
    requirements: requirements.isSuccess && either.every((r) => !!choices[r.id]),
    payment: !!methods.data?.some((m) => m.id === methodId),
  });
  const blocked =
    servicesQ.isError ||
    bookable.isError ||
    settings.isError ||
    !settings.data ||
    billing.isError ||
    !Number.isFinite(quote.total) ||
    (needsRate && (packageRate.isError || packageRate.data == null)) ||
    (tutoring && caps.isError);
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
    hasAddress: !!addressId,
  });
  async function applyPromo() {
    if (!promo.trim() || !service) return;
    setChecking(true);
    setError("");
    try {
      const r = await validatePromoCode(promo.trim(), service.service.id, quote.subtotal);
      if (r.ok) setApplied({ id: r.promo_code_id, discount: r.discount_amount });
      else {
        setApplied(null);
        setError(
          t(`bookFlow.promoError.${r.reason}`, {
            defaultValue: t("bookFlow.promoError.not_found"),
          }),
        );
      }
    } catch {
      setError(t("common.somethingWentWrong"));
    } finally {
      setChecking(false);
    }
  }
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
      const { data: clashes, error: clashError } = await supabase
        .from("bookings")
        .select("id")
        .eq("provider_id", providerId)
        .in("status", [
          "pending",
          "confirmed",
          "on_the_way",
          "arrived",
          "arrival_confirmed",
          "in_progress",
          "completion_requested",
        ])
        .lt("start_at", currentSlot.end.toISOString())
        .gt("end_at", currentSlot.start.toISOString())
        .limit(1);
      if (clashError) throw clashError;
      if (clashes?.length) {
        setSlot(null);
        setStep(1);
        setError(t("bookFlow.slotTaken"));
        await slots.refetch();
        return;
      }
      const payload = buildBookingRequest({
        providerId,
        serviceId: service.service.id,
        addressId,
        forWhom: recipient,
        start: currentSlot.start,
        end: currentSlot.end,
        promoStatus: applied ? "applied" : "idle",
        appliedPromoId: applied?.id ?? null,
        notes,
        eitherRequirements: either,
        requirementChoices: choices,
        selectedCapability: capability,
      });
      idempotency.current = resolveIdempotencyKey(
        idempotency.current,
        bookingSubmissionFingerprint(payload),
        randomUUID,
      );
      const booking = await create.mutateAsync({
        ...payload,
        idempotency_key: idempotency.current.key,
      });
      createdId.current = booking.id;
      const method = methods.data!.find((m) => m.id === methodId)!;
      // Persist before navigation so payment recovery survives a fetch failure or app restart.
      await stashPayment(booking.id, {
        paymentMethodId: method.id,
        methodType: method.method_type,
      });
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
      const paymentPlan = planPostCreatePayment(booking, method);
      if (paymentPlan.action === "create_now") {
        try {
          const payment = await createPayment.mutateAsync({
            bookingId: booking.id,
            paymentMethodId: method.id,
            methodType: method.method_type,
          });
          await clearPayment(booking.id);
          if (method.method_type === "online") await startPaymob(booking.id, payment.id);
        } catch {
          /* Booking is already created; detail recovers payment or offers checkout retry. */
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
        onChange={setRecipient}
        options={[
          ...(!babysitting ? [{ value: "myself", label: t("bookFlow.forWhomMyself") }] : []),
          ...(members.data ?? [])
            .filter(
              (m) =>
                !babysitting ||
                familyMemberSelectableForBabysitting(m, currentSlot?.start ?? null).ok,
            )
            .map((m) => ({ value: m.id, label: m.full_name })),
        ]}
      />
      <QueryState query={members} empty={babysitting && !members.data?.length} />
      <Button
        variant="secondary"
        label={t("customerBooking.addMember")}
        onPress={() => router.push("/family-members/new")}
      />
    </View>
  );
  return (
    <Page
      header={
        <CustomerPageHeader
          title={t(`customerBooking.titles.${BOOKING_SCREENS[step]}`, {
            name: provider.data?.profile.full_name?.split(" ")[0] || "",
          })}
          subtitle={t("customerRound2.step", { step: String(step + 1), total: "4" })}
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
            <Text size="xxl" weight="heavy" tone="brand" style={ui.ltr}>
              {loading ? t("common.loading") : money(quote.total, lang)}
            </Text>
          </View>
          <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
            <View style={{ flex: 1 }}>
              <Button
                label={t(step === 3 ? "mobileBooking.confirmBooking" : "common.continue")}
                loading={busy}
                disabled={!!missing || !!blocked || loading || checking}
                onPress={() => {
                  setError("");
                  if (step === 3) void submit();
                  else setStep(step + 1);
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
      <QueryState query={provider} />
      <QueryState query={servicesQ} />
      <QueryState query={bookable} />
      <QueryState query={settings} />
      <QueryState query={billing} />
      {needsRate && <QueryState query={packageRate} />}
      {!pinned.length && !addresses.isLoading && (
        <>
          <Text>{t("customerHome.addressHint")}</Text>
          <Button label={t("addresses.addAddress")} onPress={() => router.push("/addresses/new")} />
        </>
      )}
      {step === 0 && (
        <>
          <View
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
                {String(provider.data?.ratings?.rating_avg ?? 0)} ·{" "}
                {t("customerBooking.jobs", {
                  count: provider.data?.ratings?.rating_count ?? 0,
                  countLabel: String(provider.data?.ratings?.rating_count ?? 0),
                })}
              </Text>
            </View>
          </View>
          <Text weight="bold">{t("search2.service")}</Text>
          {services.map((s) => (
            <BookingServiceCard
              key={s.service.id}
              selected={s.service.id === service?.service.id}
              title={localized(s.service, lang)}
              subtitle={
                isFixedPackage(s.service)
                  ? t(packageLabel(s.service).key, packageLabel(s.service).values)
                  : s.service.category?.slug === "tutoring"
                    ? t("customerBooking.tutoringPrice")
                    : `${money(s.price_override ?? provider.data?.hourly_rate ?? 0, lang)} ${t("customerBooking.hours")}`
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
            />
          ))}
          {!services.length && !loading && <Text>{t("bookFlow.unavailableBody")}</Text>}
          {tutoring ? (
            <>
              {recipientUI}
              <QueryState query={caps} empty={!caps.data?.length} />
              <BookingEducation
                curriculum={curriculum}
                level={level}
                onChange={(c, l) => {
                  setCurriculum(c);
                  setLevel(l);
                  setCapId("");
                  userCap.current = false;
                }}
              />
              <Choices
                layout="cards"
                label={t("bookingUx.chooseSession")}
                value={capId}
                onChange={(v) => {
                  setCapId(v);
                  userCap.current = true;
                }}
                options={(caps.data ?? [])
                  .filter(
                    (c) =>
                      (!curriculum || c.curriculumId === curriculum) &&
                      (!level || c.levelId === level),
                  )
                  .map((c) => ({
                    value: c.id,
                    label: `${lang === "ar" ? c.subjectNameAr : c.subjectNameEn} · ${t("bookFlow.sessionLine", { minutes: String(c.durationMin) })} · ${money(c.price, lang)}`,
                  }))}
              />
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
            </>
          ) : fixed ? (
            <Text>
              {t(packageLabel(service!.service).key, packageLabel(service!.service).values)}
            </Text>
          ) : (
            <View style={ui.card}>
              <Text size="xl" weight="heavy">
                {t("customerBooking.duration", { hours: String(hours) })}
              </Text>
              <View style={ui.wrap}>
                <Button
                  variant="secondary"
                  style={{ flex: 1 }}
                  label={t("mobileBooking.less")}
                  disabled={hours <= 2}
                  onPress={() => setHours(hours - 1)}
                />
                <Button
                  variant="secondary"
                  style={{ flex: 1 }}
                  label={t("mobileBooking.more")}
                  disabled={hours >= 8}
                  onPress={() => setHours(hours + 1)}
                />
              </View>
            </View>
          )}
        </>
      )}
      {step === 1 && (
        <CustomerBookingWhen
          providerId={providerId}
          serviceId={service?.service.id ?? ""}
          addressId={addressId}
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
      )}
      {step === 2 && (
        <>
          <QueryState query={addresses} empty={!pinned.length} />
          <Choices
            layout="cards"
            label={t("bookingUx.chooseAddress")}
            value={addressId}
            onChange={(v) => {
              setAddressId(v);
              setSlot(null);
            }}
            options={pinned.map((a) => ({
              value: a.id,
              label: [a.area, a.street, a.building].filter(Boolean).join(" · "),
            }))}
          />
          <Button
            variant="secondary"
            label={t("addresses.addAddress")}
            onPress={() => router.push("/addresses/new")}
          />
          <QueryState query={zone} empty={!zone.data} emptyKey="bookingUx.outsideArea" />
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
                      label: `${t("mobileBooking.providerProvides")} · ${money(r.provider_extra_fee, lang)}`,
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
      {step === 3 && (
        <>
          <View>
            {[
              {
                label: t("bookFlow.stepName.service"),
                value: localized(service?.service, lang),
                step: 0,
              },
              {
                label: t("bookFlow.rowDate"),
                value: currentSlot
                  ? dateTime(currentSlot.start.toISOString(), lang)
                  : t("bookFlow.dash"),
                step: 1,
              },
              {
                label: t("bookFlow.rowAddress"),
                value: [selectedAddress?.area, selectedAddress?.street].filter(Boolean).join(" · "),
                step: 2,
              },
              {
                label: t("customerBooking.recipient"),
                value:
                  recipient === "myself"
                    ? t("bookFlow.forWhomMyself")
                    : members.data?.find((m) => m.id === recipient)?.full_name,
                step: tutoring ? 0 : 2,
              },
            ].map((row) => (
              <View
                key={row.label}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  paddingVertical: 10,
                  borderBottomWidth: 1,
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
                  onPress={() => setStep(row.step)}
                  style={{ minWidth: 44, minHeight: 44, justifyContent: "center" }}
                >
                  <Text size="sm" tone="brand" weight="bold">
                    {t("common.edit")}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("customerBooking.promo")}
            accessibilityState={{ expanded: promoOpen }}
            onPress={() => setPromoOpen(!promoOpen)}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <Text weight="heavy" tone="brand">
              {t("customerBooking.promo")}
            </Text>
          </Pressable>
          {promoOpen && (
            <>
              <Field
                label={t("mobileBooking.promo")}
                value={promo}
                onChangeText={(v) => {
                  setPromo(v);
                  setApplied(null);
                }}
              />
              <Button
                variant="secondary"
                label={t("mobileBooking.applyPromo")}
                loading={checking}
                onPress={() => void applyPromo()}
              />
              {applied && (
                <Text>{t("bookFlow.promoApplied", { amount: money(applied.discount, lang) })}</Text>
              )}
            </>
          )}
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
              extras_total: quote.extrasTotal,
              travel_fee: quote.travelFee,
              platform_fee: quote.fee,
              vat: quote.vat,
              discount: applied?.discount ?? 0,
              total: quote.total,
            })
              .filter(
                ([key, v]) =>
                  !["extras_total", "travel_fee", "discount"].includes(key) || Number(v) > 0,
              )
              .map(([key, v]) => (
                <View key={key} style={[ui.priceRow, key === "total" && ui.priceTotal]}>
                  <Text
                    style={{ flex: 1 }}
                    weight={key === "total" ? "heavy" : "regular"}
                    tone={key === "total" ? "default" : "muted"}
                  >
                    {t(`mobile.price.${key}`)}
                  </Text>
                  <Text
                    size={key === "total" ? "xl" : "md"}
                    weight="bold"
                    tone={key === "total" ? "brand" : "default"}
                    style={ui.ltr}
                  >
                    {money(v, lang)}
                  </Text>
                </View>
              ))}
          </View>
          <QueryState query={methods} empty={!methods.data?.length} />
          <Choices
            layout="cards"
            label={t("payment.title")}
            value={methodId}
            onChange={setMethodId}
            options={(methods.data ?? []).map((m) => ({ value: m.id, label: localized(m, lang) }))}
          />
          {methods.data?.find((m) => m.id === methodId)?.method_type === "online" && (
            <PaymentLogos />
          )}
        </>
      )}
      {error && <Text tone="danger">{error}</Text>}
      {reason && <Text>{t(reason)}</Text>}
      {blocked && !loading && <Text>{t("bookFlow.unavailableBody")}</Text>}

      {missing && step > 0 && (
        <Button
          variant="secondary"
          label={t("mobileBooking.editChoices")}
          onPress={() => setStep(BOOKING_SCREENS.indexOf(bookingScreenForStep(missing, tutoring)))}
        />
      )}
    </Page>
  );
}
