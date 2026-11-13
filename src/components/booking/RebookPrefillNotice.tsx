import { useTranslation } from "react-i18next";
import type { RebookPrefillNotice } from "@/lib/booking/rebookPrefill";

export function RebookPrefillNoticeList({ notices }: { notices: RebookPrefillNotice[] }) {
  const { t } = useTranslation();
  if (!notices.length) return null;
  return (
    <div className="rounded-2xl border border-warning/40 bg-warning/10 p-3 text-pro-12" role="status">
      <p className="font-bold text-foreground">{t("bookFlow.rebookPrefillTitle")}</p>
      <ul className="mt-2 list-disc space-y-1 ps-5 text-muted-foreground">
        {notices.map((notice, index) => (
          <li key={`${notice.code}-${notice.requirementId ?? index}`}>
            {t(`bookFlow.rebookDropped.${notice.code}`)}
          </li>
        ))}
      </ul>
    </div>
  );
}
