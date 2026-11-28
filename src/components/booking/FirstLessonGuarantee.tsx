import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import { formatEGP } from "@/lib/format/egp";
import {
  guaranteeCardState,
  guaranteeCoversCategory,
  guaranteeDeadlineLabel,
  guaranteeErrorKey,
} from "@/lib/offers/launchOffers";
import {
  useClaimFirstLessonGuarantee,
  useFirstLessonGuaranteeSettings,
  useFirstLessonGuaranteeStatus,
} from "@/lib/db/launch-offers-queries";

/**
 * One line under a tutor's profile or a booking summary:
 * «لو أول حصة مع المدرس مش مناسبة، فلوسها بترجع لمحفظتك».
 * Shown only while the guarantee is on and covers this section.
 */
export function FirstLessonGuaranteePromise({
  categorySlug,
  className = "",
}: {
  categorySlug: string | null | undefined;
  className?: string;
}) {
  const { t } = useTranslation();
  const q = useFirstLessonGuaranteeSettings();
  if (!guaranteeCoversCategory(q.data, categorySlug)) return null;
  return (
    <p
      className={`flex items-start gap-2 rounded-xl bg-success/10 px-3 py-2 text-xs font-semibold text-success ${className}`}
    >
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{t("firstLessonGuarantee.promise")}</span>
    </p>
  );
}

/** On a completed booking: «الحصة مكانتش مناسبة» → the price back to the wallet. */
export function FirstLessonGuaranteeCard({ bookingId }: { bookingId: string }) {
  const { t, i18n } = useTranslation();
  const q = useFirstLessonGuaranteeStatus(bookingId);
  const claim = useClaimFirstLessonGuarantee();
  const [confirming, setConfirming] = useState(false);
  const [feedback, setFeedback] = useState("");
  const state = guaranteeCardState(q.data);
  if (!state || !q.data) return null;
  const egp = (n: number) => formatEGP(n, undefined, i18n.language);

  if (state === "claimed") {
    return (
      <section
        aria-label={t("firstLessonGuarantee.claimedTitle")}
        className="mt-4 rounded-2xl border border-success/30 bg-success/10 p-4"
      >
        <p className="flex items-center gap-2 text-sm font-extrabold text-success">
          <ShieldCheck className="h-4 w-4" aria-hidden />
          {t("firstLessonGuarantee.claimedTitle")}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("firstLessonGuarantee.claimedBody", { amount: egp(q.data.claim?.amount ?? 0) })}
        </p>
      </section>
    );
  }

  if (state === "waiting") {
    return (
      <section className="mt-4 rounded-2xl border border-border/60 bg-surface-2 p-4">
        <p className="flex items-center gap-2 text-sm font-extrabold">
          <ShieldCheck className="h-4 w-4" aria-hidden />
          {t("firstLessonGuarantee.offerTitle")}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("firstLessonGuarantee.waitingBody")}
        </p>
      </section>
    );
  }

  const amount = egp(q.data.amount);
  return (
    <section
      aria-label={t("firstLessonGuarantee.offerTitle")}
      className="mt-4 rounded-2xl border border-border/60 bg-surface p-4"
    >
      <p className="flex items-center gap-2 text-sm font-extrabold">
        <ShieldCheck className="h-4 w-4 text-success" aria-hidden />
        {t("firstLessonGuarantee.offerTitle")}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("firstLessonGuarantee.offerBody", {
          amount,
          time: q.data.expires_at ? guaranteeDeadlineLabel(q.data.expires_at, i18n.language) : "",
        })}
      </p>
      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="focus-ring mt-3 min-h-11 w-full rounded-xl border border-border px-3 text-sm font-bold"
        >
          {t("firstLessonGuarantee.offerButton")}
        </button>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="text-sm font-bold">{t("firstLessonGuarantee.confirmTitle")}</p>
          <p className="text-xs text-muted-foreground">
            {t("firstLessonGuarantee.confirmBody", { amount })}
          </p>
          <label
            htmlFor={`guarantee-feedback-${bookingId}`}
            className="block text-xs font-semibold"
          >
            {t("firstLessonGuarantee.feedbackLabel")}
          </label>
          <textarea
            id={`guarantee-feedback-${bookingId}`}
            rows={2}
            maxLength={500}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={claim.isPending}
              onClick={() =>
                claim.mutate(
                  { bookingId, feedback: feedback.trim() || null },
                  {
                    onSuccess: (r) => {
                      toast.success(t("firstLessonGuarantee.success", { amount: egp(r.amount) }));
                      setConfirming(false);
                    },
                    onError: (e) =>
                      toast.error(t(guaranteeErrorKey((e as { message?: string })?.message))),
                  },
                )
              }
              className="focus-ring min-h-11 flex-1 rounded-xl bg-brand px-3 text-sm font-bold text-brand-foreground disabled:opacity-50"
            >
              {t("firstLessonGuarantee.confirm")}
            </button>
            <button
              type="button"
              disabled={claim.isPending}
              onClick={() => setConfirming(false)}
              className="focus-ring min-h-11 flex-1 rounded-xl border border-border px-3 text-sm font-bold"
            >
              {t("firstLessonGuarantee.cancel")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
