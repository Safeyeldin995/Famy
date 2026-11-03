import { ServicePricePicker, isPriceInRange } from "@/components/provider/ServicePricePicker";
import {
  buildAgeGroupsFromChips,
  buildRequirementFulfillmentPayload,
  validateTeachingGroups,
  type TeachingGroupDraft,
} from "@/lib/provider/serviceRequestPayload";
import { AGE_GROUP_CHIP_IDS } from "@/lib/provider/ageGroupCapabilities";
import {
  useDeclareRequirement,
  useMyRequirementFulfillments,
  useProviderRequestService,
  useRequirementsForService,
  useUploadRequirementEvidence,
} from "@/lib/db/provider-queries";
import {
  useTeachingCurricula,
  useTeachingLevels,
  useTeachingSubjectServices,
  useTeachingSubjects,
} from "@/lib/db/teaching-queries";
import { isTutoringCategorySlug } from "@/lib/tutoring/teachingCapabilities";
import { teachingLevelsForCurriculum } from "@/lib/tutoring/teachingLevelFilters";
import { servicePriceUnit } from "@/lib/pricing/servicePackages";
import { PrimaryButton } from "@/components/famio/ui";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Upload } from "lucide-react";

type ServiceRow = {
  id: string;
  name_en?: string | null;
  name_ar?: string | null;
  category?: { slug?: string | null } | null;
  provider_pricing_allowed?: boolean | null;
  minimum_price?: number | null;
  maximum_price?: number | null;
  allowed_session_durations?: number[] | null;
};

export function ProviderServiceRequestForm({
  providerId,
  service,
  onSubmitted,
}: {
  providerId: string;
  service: ServiceRow;
  onSubmitted: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "ar" ? "ar" : "en";
  const submit = useProviderRequestService();
  const reqQ = useRequirementsForService(service.id);
  const mineQ = useMyRequirementFulfillments(providerId);
  const declare = useDeclareRequirement();
  const upload = useUploadRequirementEvidence();

  const subjectsQ = useTeachingSubjects();
  const curriculaQ = useTeachingCurricula();
  const levelsQ = useTeachingLevels();
  const linksQ = useTeachingSubjectServices();

  const isTutoring = isTutoringCategorySlug(service.category?.slug);
  const isBabysitting = service.category?.slug === "babysitting";

  const [price, setPrice] = useState<number | null>(null);
  const [maxChildren, setMaxChildren] = useState<number | "">("");
  const [ageChips, setAgeChips] = useState<string[]>([]);
  const [teachingGroups, setTeachingGroups] = useState<TeachingGroupDraft[]>([]);

  const [draftSubject, setDraftSubject] = useState("");
  const [draftCurriculum, setDraftCurriculum] = useState("");
  const [draftLevels, setDraftLevels] = useState<string[]>([]);
  const [draftDuration, setDraftDuration] = useState(
    service.allowed_session_durations?.[0] ?? 60,
  );
  const [draftPrice, setDraftPrice] = useState<number | null>(null);

  const approvalRequirements = useMemo(
    () => (reqQ.data ?? []).filter((r) => r.required_for_provider_approval),
    [reqQ.data],
  );

  const linkedSubjectIds = useMemo(
    () =>
      new Set(
        (linksQ.data ?? [])
          .filter((link) => link.service_id === service.id)
          .map((link) => link.subject_id),
      ),
    [linksQ.data, service.id],
  );
  const subjects = (subjectsQ.data ?? []).filter((row) => linkedSubjectIds.has(row.id));
  const curriculum = (curriculaQ.data ?? []).find((row) => row.id === draftCurriculum);
  const filteredLevels = useMemo(
    () => teachingLevelsForCurriculum(curriculum?.code, levelsQ.data ?? []),
    [curriculum?.code, levelsQ.data],
  );

  const serviceName =
    lang === "ar" ? (service.name_ar ?? service.name_en) : (service.name_en ?? service.name_ar);

  const addTeachingGroup = () => {
    if (!draftSubject || !draftCurriculum || draftLevels.length === 0 || draftPrice == null) {
      toast.error(t("pro.serviceRequest.teachingIncomplete"));
      return;
    }
    if (
      !isPriceInRange(draftPrice, service.minimum_price ?? null, service.maximum_price ?? null)
    ) {
      toast.error(t("pricePicker.outOfRange"));
      return;
    }
    setTeachingGroups((rows) => [
      ...rows,
      {
        subject_id: draftSubject,
        curriculum_id: draftCurriculum,
        level_ids: draftLevels,
        session_duration_min: draftDuration,
        session_price: draftPrice,
      },
    ]);
    setDraftSubject("");
    setDraftCurriculum("");
    setDraftLevels([]);
    setDraftPrice(null);
  };

  const handleSubmit = () => {
    const payload: Record<string, unknown> = {};
    if (isTutoring) {
      const teachingError = validateTeachingGroups(teachingGroups);
      if (teachingError) {
        toast.error(t(`pro.serviceRequest.${teachingError}`));
        return;
      }
      payload.teaching_groups = teachingGroups;
    } else if (service.provider_pricing_allowed) {
      if (!isPriceInRange(price, service.minimum_price ?? null, service.maximum_price ?? null)) {
        toast.error(t("pricePicker.outOfRange"));
        return;
      }
      payload.price_override = price;
    }
    if (isBabysitting) {
      if (maxChildren === "" || maxChildren < 1 || maxChildren > 6) {
        toast.error(t("pro.serviceRequest.maxChildrenRequired"));
        return;
      }
      payload.max_children_per_booking = maxChildren;
      if (ageChips.length > 0) {
        payload.age_group_capabilities = buildAgeGroupsFromChips(ageChips, {}, {});
      }
    }
    const fulfillmentPayload = buildRequirementFulfillmentPayload(
      approvalRequirements.map((r) => r.id),
      mineQ.data ?? [],
    );
    for (const req of approvalRequirements) {
      const row = fulfillmentPayload.find((f) => f.requirement_id === req.id);
      if (req.evidence_required && !row?.evidence_storage_path) {
        toast.error(t("pro.serviceRequest.missingEvidence", { name: req.name_en }));
        return;
      }
    }
    if (fulfillmentPayload.length) payload.requirement_fulfillments = fulfillmentPayload;

    submit.mutate(
      { serviceId: service.id, payload, idempotencyKey: crypto.randomUUID() },
      {
        onSuccess: () => {
          toast.success(t("pro.serviceRequest.submitted"));
          onSubmitted();
        },
        onError: (e: unknown) => {
          const message =
            e && typeof e === "object" && "message" in e ? String(e.message) : undefined;
          toast.error(message ?? t("common.somethingWentWrong"));
        },
      },
    );
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t("pro.serviceRequest.intro", { service: serviceName })}
      </p>

      {isTutoring && (
        <section className="space-y-3 rounded-2xl border border-border p-4">
          <h3 className="text-sm font-bold">{t("pro.serviceRequest.teachingTitle")}</h3>
          <div className="grid gap-2">
            <select
              className="min-h-11 rounded-xl border border-border bg-surface px-3 text-sm"
              value={draftSubject}
              onChange={(e) => setDraftSubject(e.target.value)}
            >
              <option value="">{t("teaching.pickSubject")}</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {lang === "ar" ? s.name_ar : s.name_en}
                </option>
              ))}
            </select>
            <select
              className="min-h-11 rounded-xl border border-border bg-surface px-3 text-sm"
              value={draftCurriculum}
              onChange={(e) => setDraftCurriculum(e.target.value)}
            >
              <option value="">{t("teaching.pickCurriculum")}</option>
              {(curriculaQ.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {lang === "ar" ? c.name_ar : c.name_en}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap gap-2">
              {filteredLevels.map((level) => {
                const on = draftLevels.includes(level.id);
                return (
                  <button
                    key={level.id}
                    type="button"
                    className={`min-h-11 rounded-xl border px-3 text-xs font-bold ${on ? "border-brand bg-brand/10 text-brand" : "border-border"}`}
                    onClick={() =>
                      setDraftLevels((ids) =>
                        on ? ids.filter((id) => id !== level.id) : [...ids, level.id],
                      )
                    }
                  >
                    {lang === "ar" ? level.name_ar : level.name_en}
                  </button>
                );
              })}
            </div>
            <select
              className="min-h-11 rounded-xl border border-border bg-surface px-3 text-sm"
              value={draftDuration}
              onChange={(e) => setDraftDuration(Number(e.target.value))}
            >
              {(service.allowed_session_durations ?? [60]).map((d) => (
                <option key={d} value={d}>
                  {t("teaching.durationMinutes", { minutes: d })}
                </option>
              ))}
            </select>
            <ServicePricePicker
              min={service.minimum_price ?? null}
              max={service.maximum_price ?? null}
              value={draftPrice}
              onChange={setDraftPrice}
              unitLabel={t(
              servicePriceUnit(service as Parameters<typeof servicePriceUnit>[0]).key,
              servicePriceUnit(service as Parameters<typeof servicePriceUnit>[0]).values,
            )}
            />
            <button
              type="button"
              className="min-h-11 rounded-xl border border-brand px-3 text-sm font-bold text-brand"
              onClick={addTeachingGroup}
            >
              {t("pro.serviceRequest.addTeachingGroup")}
            </button>
          </div>
          {teachingGroups.length > 0 && (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {teachingGroups.map((g, idx) => (
                <li key={idx}>
                  {t("pro.serviceRequest.teachingGroupLine", {
                    count: g.level_ids.length,
                    price: g.session_price,
                    duration: g.session_duration_min,
                  })}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {!isTutoring && service.provider_pricing_allowed && (
        <section className="rounded-2xl border border-border p-4">
          <h3 className="mb-2 text-sm font-bold">{t("pro.serviceRequest.priceTitle")}</h3>
          <ServicePricePicker
            min={service.minimum_price ?? null}
            max={service.maximum_price ?? null}
            value={price}
            onChange={setPrice}
            unitLabel={t(
              servicePriceUnit(service as Parameters<typeof servicePriceUnit>[0]).key,
              servicePriceUnit(service as Parameters<typeof servicePriceUnit>[0]).values,
            )}
          />
        </section>
      )}

      {isBabysitting && (
        <section className="space-y-3 rounded-2xl border border-border p-4">
          <h3 className="text-sm font-bold">{t("pro.serviceRequest.babysittingTitle")}</h3>
          <label className="block text-xs font-semibold">
            {t("pro.serviceRequest.maxChildren")}
            <input
              type="number"
              min={1}
              max={6}
              className="mt-1 min-h-11 w-full rounded-xl border border-border px-3"
              value={maxChildren}
              onChange={(e) =>
                setMaxChildren(e.target.value === "" ? "" : Number(e.target.value))
              }
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {AGE_GROUP_CHIP_IDS.map((chip: (typeof AGE_GROUP_CHIP_IDS)[number]) => {
              const on = ageChips.includes(chip);
              return (
                <button
                  key={chip}
                  type="button"
                  className={`min-h-11 rounded-xl border px-3 text-xs font-bold ${on ? "border-brand bg-brand/10" : "border-border"}`}
                  onClick={() =>
                    setAgeChips((ids) =>
                      on ? ids.filter((id) => id !== chip) : [...ids, chip],
                    )
                  }
                >
                  {t(`pro.onboardingWizard.ageGroups.${chip}`)}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {approvalRequirements.length > 0 && (
        <section className="space-y-2 rounded-2xl border border-border p-4">
          <h3 className="text-sm font-bold">{t("providerProfilePolish.requirements")}</h3>
          <ul className="space-y-2">
            {approvalRequirements.map((r) => {
              const mine = (mineQ.data ?? []).find((f) => f.requirement_id === r.id);
              return (
                <li key={r.id} className="rounded-xl border border-border/60 p-2 text-xs">
                  <p className="font-semibold">{lang === "ar" ? r.name_ar : r.name_en}</p>
                  {r.evidence_required && (
                    <label className="mt-2 inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-lg border border-border px-2 py-1.5 font-semibold">
                      <Upload className="h-3 w-3" />
                      {mine?.evidence_storage_path
                        ? t("pro.profile.reevidence")
                        : t("pro.profile.uploadEvidence")}
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f)
                            upload.mutate(
                              { providerId, requirementId: r.id, file: f },
                              {
                                onError: (err: unknown) =>
                                  toast.error(
                                    err && typeof err === "object" && "message" in err
                                      ? String(err.message)
                                      : t("common.somethingWentWrong"),
                                  ),
                              },
                            );
                          e.target.value = "";
                        }}
                      />
                    </label>
                  )}
                  <input
                    className="mt-2 min-h-11 w-full rounded-lg border border-border px-2"
                    placeholder={t("pro.profile.reqNotesPlaceholder")}
                    defaultValue={mine?.notes ?? ""}
                    onBlur={(e) =>
                      declare.mutate({
                        providerId,
                        requirementId: r.id,
                        notes: e.target.value,
                      })
                    }
                  />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <PrimaryButton className="w-full" disabled={submit.isPending} onClick={handleSubmit}>
        {submit.isPending ? t("pro.common.saving") : t("pro.serviceRequest.submit")}
      </PrimaryButton>
    </div>
  );
}
