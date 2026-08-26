import { useTranslation } from "react-i18next";
import famyLogo from "@/assets/famy-wordmark.png";

const SIZE_CLASS = {
  compact: "h-14",
  header: "h-[4.25rem]",
  auth: "h-24",
  splash: "h-32",
} as const;

export function FamyWordmark({
  size = "header",
  className = "",
}: {
  size?: keyof typeof SIZE_CLASS;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <img
      src={famyLogo}
      alt={t("common.appName")}
      className={`${SIZE_CLASS[size]} w-auto max-w-full object-contain object-start ${className}`}
    />
  );
}
