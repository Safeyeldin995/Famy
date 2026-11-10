import { useTranslation } from "react-i18next";
import { fonts } from "../theme";

export function useInputFont(weight: "regular" | "bold" = "regular") {
  const { i18n } = useTranslation();
  return (i18n.language === "en" ? fonts.en : fonts.ar)[weight];
}
