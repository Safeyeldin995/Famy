import { useTranslation } from "react-i18next";
import wordmarkWhite from "@/assets/splash/wordmark-white.png";
import famyLogo from "@/assets/famy-wordmark.png";

const SIZE_CLASS = {
  compact: "h-16",
  header: "h-[5.5rem]",
  auth: "h-28",
  splash: "h-32",
} as const;

export function FamyWordmark({
  size = "header",
  variant = "default",
  className = "",
}: {
  size?: keyof typeof SIZE_CLASS;
  variant?: "default" | "white";
  className?: string;
}) {
  const { t } = useTranslation();
  const src = variant === "white" ? wordmarkWhite : famyLogo;
  return (
    <img
      src={src}
      alt={t("common.appName")}
      className={`${SIZE_CLASS[size]} w-auto max-w-[min(71vw,385px)] object-contain ${className}`}
    />
  );
}
