import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { proPath } from "@/lib/preview/previewPath";
import { groupTeachingRows } from "@/lib/tutoring/teachingGroups";
import type { ProviderTeachingCapabilityRow } from "@/lib/db/teaching-queries";

export function TeachingGroupsSummary({ rows }: { rows: ProviderTeachingCapabilityRow[] }) {
  const { t, i18n } = useTranslation();
  const ar = i18n.language.startsWith("ar");
  const name = (row?: { name_ar: string; name_en: string } | null) =>
    row ? (ar ? row.name_ar : row.name_en) : "";
  return (
    <section id="teaching-subjects" className="apply-list scroll-mt-4">
      <h2 className="apply-label px-4 pt-4">{t("providerProfileV3.subjects")}</h2>
      {groupTeachingRows(rows).map((group) => (
        <div key={group.key} className="apply-li flex-wrap">
          <div className="apply-task-text">
            <b>
              {name(group.first.subject)} · {name(group.first.curriculum)}
            </b>
            <small>{group.rows.map((row) => name(row.level)).join(" · ")}</small>
            <small>
              {group.first.session_duration_min} {t("common.min")} · {group.first.session_price}{" "}
              {t("pricePicker.sessionUnit")}
            </small>
          </div>
          <div className="flex flex-wrap gap-2">
            {[...new Set(group.rows.map((row) => row.status))].map((status) => (
              <span
                key={status}
                className={`apply-tag ${status === "approved" ? "apply-success" : status === "pending" ? "apply-wait" : "apply-danger"}`}
              >
                {t(`providerSetup.status.${status}`)}
              </span>
            ))}
          </div>
        </div>
      ))}
      <Link
        to={proPath("/pro/setup/$item") as "/pro/setup/$item"}
        params={{ item: "subjects" }}
        className="apply-li text-brand font-bold"
      >
        {t("providerProfileV3.addSubject")}
      </Link>
    </section>
  );
}
