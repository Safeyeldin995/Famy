import { useTranslation } from "react-i18next";
import { useServiceAreasSettings } from "@/lib/db/settings-queries";
import { customerAreaLabel } from "@/components/famio/customerAreaLabel";

/** Enabled service areas from admin settings, in the current language. */
export function useServiceAreas(): string[] {
  const { t } = useTranslation();
  const q = useServiceAreasSettings();
  return (q.data ?? []).filter((a) => a.enabled).map((a) => customerAreaLabel(a.name, t));
}
