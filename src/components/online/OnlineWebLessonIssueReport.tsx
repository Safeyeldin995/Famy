import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { PrimaryButton } from "@/components/famio/ui";
import { supabase } from "@/integrations/supabase/client";
import { onlineLessonReportWindow } from "@/lib/livekit/sessionAccess";
import { toast } from "sonner";

type Props = { bookingId: string; startAt: string; endAt: string };

const CATEGORIES = ["absence", "connection", "behavior"] as const;

export function OnlineWebLessonIssueReport({ bookingId, startAt, endAt }: Props) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("connection");
  const [detail, setDetail] = useState("");
  const [done, setDone] = useState(false);
  const window = onlineLessonReportWindow(new Date(startAt), new Date(endAt));

  const submit = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as never as { rpc: (name: string, args: object) => ReturnType<typeof supabase.rpc> }).rpc(
        "report_online_lesson_issue",
        {
          p_booking_id: bookingId,
          p_category: category,
          p_description: detail.trim(),
        },
      );
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      setDone(true);
      toast.success(t("onlineSession.lessonReportSubmitted"));
    },
    onError: () => toast.error(t("common.somethingWentWrong")),
  });

  if (!window.open) return null;

  if (done) {
    return (
      <ReportCard title={t("onlineSession.lessonReportSubmitted")}>
        <p className="text-pro-14 text-muted-foreground">{t("onlineSession.lessonReportReviewEta")}</p>
      </ReportCard>
    );
  }

  return (
    <ReportCard title={t("onlineSession.lessonReportTitle")}>
      <p className="text-pro-13 font-bold text-muted-foreground">{t("onlineSession.lessonReportCategory")}</p>
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((value) => {
          const active = category === value;
          return (
            <button
              key={value}
              type="button"
              className={`rounded-2xl border px-3 py-2 text-pro-13 font-bold ${
                active ? "border-brand bg-brand/10 text-brand" : "border-border bg-white"
              }`}
              onClick={() => setCategory(value)}
            >
              {t(`onlineSession.lessonReportCategories.${value}`)}
            </button>
          );
        })}
      </div>
      <label className="block">
        <span className="sr-only">{t("onlineSession.lessonReportPlaceholder")}</span>
        <textarea
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          className="mt-1 min-h-24 w-full rounded-2xl border border-border bg-white p-3 text-pro-14"
          placeholder={t("onlineSession.lessonReportPlaceholder")}
        />
      </label>
      <PrimaryButton
        className="h-11 w-full"
        disabled={detail.trim().length < 10 || submit.isPending}
        onClick={() => void submit.mutate()}
      >
        {t("onlineSession.lessonReportSubmit")}
      </PrimaryButton>
    </ReportCard>
  );
}

function ReportCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border border-border/60 bg-white p-4 shadow-sm">
      <h2 className="text-pro-16 font-bold">{title}</h2>
      {children}
    </section>
  );
}