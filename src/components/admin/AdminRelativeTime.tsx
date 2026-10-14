import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { adminDate, adminRelativeAge } from "./adminPresentation";

/** Initial HTML is deterministic; relative labels start only after hydration. */
export function AdminRelativeTime({
  value,
  oldest = false,
}: {
  value: string | null;
  oldest?: boolean;
}) {
  const { i18n } = useTranslation();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const ar = i18n.language.startsWith("ar");
  return (
    <span title={adminDate(value, i18n.language)}>
      {now !== null && value
        ? (oldest ? (ar ? "أقدم حاجة مستنية من " : "Oldest waiting for ") : ar ? "من " : "Ago: ") +
          adminRelativeAge(value, now, i18n.language)
        : "—"}
    </span>
  );
}
