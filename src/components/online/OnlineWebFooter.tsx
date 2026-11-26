import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import wordmark from "@/assets/famy-wordmark.png";

/** Site footer for the online lessons web surface (legal, help, tutor recruiting). */
export function OnlineWebFooter() {
  const { t } = useTranslation();
  const year = new Date().getFullYear();
  const linkClass =
    "focus-ring rounded text-pro-13 font-semibold text-muted-foreground hover:text-foreground";
  return (
    <footer className="border-t border-border/60 bg-white">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 sm:px-5 md:grid-cols-[1fr_auto] md:items-center">
        <div className="min-w-0 space-y-2">
          <img src={wordmark} alt="" width={1092} height={375} className="h-7 w-auto max-w-[5.5rem] object-contain" />
          <p className="text-pro-13 text-muted-foreground">{t("onlineWeb.hub.footerTagline")}</p>
        </div>
        <nav aria-label={t("onlineWeb.hub.footerHelp")}>
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            <li>
              <Link to="/content/$key" params={{ key: "terms" }} className={linkClass}>
                {t("onlineWeb.hub.footerTerms")}
              </Link>
            </li>
            <li>
              <Link to="/content/$key" params={{ key: "privacy" }} className={linkClass}>
                {t("onlineWeb.hub.footerPrivacy")}
              </Link>
            </li>
            <li>
              <Link to="/help" className={linkClass}>
                {t("onlineWeb.hub.footerHelp")}
              </Link>
            </li>
            <li>
              <Link to="/pro/apply" className={linkClass}>
                {t("onlineWeb.hub.footerBecomeTutor")}
              </Link>
            </li>
            <li>
              <a href="/" className={linkClass}>
                {t("onlineWeb.hub.footerInPerson")}
              </a>
            </li>
          </ul>
        </nav>
      </div>
      <p className="border-t border-border/40 py-3 text-center text-pro-12 text-muted-foreground">
        © <span dir="ltr">{year}</span> {t("onlineWeb.hub.footerRights")}
      </p>
    </footer>
  );
}
