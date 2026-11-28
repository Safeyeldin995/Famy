import { useTranslation } from "react-i18next";
import { BadgeCheck, BriefcaseBusiness, GraduationCap } from "lucide-react";
import { usePublicCredentials } from "@/lib/db/credential-queries";
import { yearRange } from "@/lib/provider/credentials";

/**
 * Public tutor profile: education, experience and admin-verified certificates.
 * Renders nothing while loading, on error, or when the provider added none.
 */
export function ProviderCredentialsSection({
  providerId,
  className = "space-y-4 rounded-3xl bg-white p-6 shadow-sm",
}: {
  providerId: string | undefined;
  className?: string;
}) {
  const { t } = useTranslation();
  const q = usePublicCredentials(providerId);
  const d = q.data;
  if (!d || (!d.education.length && !d.experience.length && !d.certificates.length)) return null;
  const present = t("providerCredentials.present");
  return (
    <section className={className} aria-label={t("providerCredentials.admin.title")}>
      {d.certificates.length ? (
        <div className="space-y-2">
          <h2 className="text-pro-18 font-extrabold">{t("providerCredentials.profile.certificates")}</h2>
          <ul className="space-y-2">
            {d.certificates.map((c) => (
              <li key={c.id} className="flex items-start gap-3">
                <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />
                <div className="min-w-0">
                  <p className="font-bold">{c.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {c.issuer}
                    {c.issued_year ? ` · ${c.issued_year}` : ""}
                  </p>
                  <p className="text-xs font-bold text-success">
                    {t("providerCredentials.certificates.verifiedBadge")}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {d.education.length ? (
        <div className="space-y-2">
          <h2 className="text-pro-18 font-extrabold">{t("providerCredentials.profile.education")}</h2>
          <ul className="space-y-2">
            {d.education.map((e) => {
              const years = yearRange(e.start_year, e.end_year, false, present);
              return (
                <li key={e.id} className="flex items-start gap-3">
                  <GraduationCap className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
                  <div className="min-w-0">
                    <p className="font-bold">
                      {e.degree}
                      {e.field_of_study ? ` · ${e.field_of_study}` : ""}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {e.institution}
                      {years ? ` · ${years}` : ""}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {d.experience.length ? (
        <div className="space-y-2">
          <h2 className="text-pro-18 font-extrabold">{t("providerCredentials.profile.experience")}</h2>
          <ul className="space-y-2">
            {d.experience.map((w) => {
              const years = yearRange(w.start_year, w.end_year, w.is_current, present);
              return (
                <li key={w.id} className="flex items-start gap-3">
                  <BriefcaseBusiness className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
                  <div className="min-w-0">
                    <p className="font-bold">{w.role_title}</p>
                    <p className="text-sm text-muted-foreground">
                      {w.place}
                      {years ? ` · ${years}` : ""}
                    </p>
                    {w.description ? (
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm">{w.description}</p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
