import { Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Menu, X } from "lucide-react";
import wordmark from "@/assets/famy-wordmark.png";
import i18n from "@/lib/i18n";
import { LanguageToggle } from "@/components/famio/LanguageToggle";
import { StoreBadges } from "./StoreBadges";

const NAV = [
  { to: "/", key: "site.nav.home" },
  { to: "/about", key: "site.nav.about" },
  { to: "/join", key: "site.nav.join" },
  { to: "/contact", key: "site.nav.contact" },
] as const;

/** Public website shell (header, footer). The app itself lives under /app. */
export function SiteLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const refreshHead = () => void router.invalidate();
    i18n.on("languageChanged", refreshHead);
    return () => i18n.off("languageChanged", refreshHead);
  }, [router]);

  return (
    <div className="min-h-dvh bg-white text-foreground">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5">
          <Link to="/" className="focus-ring shrink-0" aria-label={t("common.appName")}>
            <img
              src={wordmark}
              alt={t("common.appName")}
              width={1092}
              height={344}
              className="h-8 w-auto max-w-[6.5rem] object-contain"
            />
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label={t("site.nav.label")}>
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: true }}
                className="focus-ring inline-flex min-h-11 items-center rounded-full px-4 text-pro-14 font-bold text-muted-foreground transition-colors hover:text-foreground"
                activeProps={{ className: "!text-brand" }}
              >
                {t(item.key)}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <LanguageToggle variant="inline" />
            <Link
              to="/app"
              className="focus-ring hidden min-h-11 items-center rounded-full bg-brand px-5 text-pro-14 font-extrabold text-brand-foreground sm:inline-flex"
            >
              {t("site.nav.openApp")}
            </Link>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-label={t("site.nav.menu")}
              className="focus-ring grid h-11 w-11 place-items-center rounded-full border border-border/70 md:hidden"
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {open ? (
          <nav
            className="border-t border-border/60 px-5 py-3 md:hidden"
            aria-label={t("site.nav.label")}
          >
            <div className="mx-auto flex max-w-6xl flex-col">
              {NAV.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setOpen(false)}
                  activeOptions={{ exact: true }}
                  className="focus-ring flex min-h-12 items-center text-pro-16 font-bold"
                  activeProps={{ className: "text-brand" }}
                >
                  {t(item.key)}
                </Link>
              ))}
              <Link
                to="/app"
                className="focus-ring mt-2 flex min-h-12 items-center justify-center rounded-2xl bg-brand text-pro-16 font-extrabold text-brand-foreground"
              >
                {t("site.nav.openApp")}
              </Link>
            </div>
          </nav>
        ) : null}
      </header>

      <main>{children}</main>

      <footer className="border-t border-border/60 bg-surface-2/60">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-12 md:grid-cols-[1.4fr_1fr_1fr]">
          <div className="space-y-4">
            <img
              src={wordmark}
              alt={t("common.appName")}
              width={1092}
              height={344}
              loading="lazy"
              decoding="async"
              className="h-9 w-auto max-w-[7rem] object-contain"
            />
            <p className="max-w-sm text-pro-14 leading-relaxed text-muted-foreground">
              {t("site.footer.tagline")}
            </p>
            <StoreBadges />
          </div>
          <div>
            <h2 className="text-pro-14 font-extrabold">{t("site.footer.company")}</h2>
            <ul className="mt-3 space-y-1">
              {NAV.slice(1).map((item) => (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    className="focus-ring inline-flex min-h-11 items-center text-pro-14 text-muted-foreground hover:text-foreground"
                  >
                    {t(item.key)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="text-pro-14 font-extrabold">{t("site.footer.legal")}</h2>
            <ul className="mt-3 space-y-1">
              <li>
                <Link
                  to="/content/$key"
                  params={{ key: "terms" }}
                  className="focus-ring inline-flex min-h-11 items-center text-pro-14 text-muted-foreground hover:text-foreground"
                >
                  {t("profile.terms")}
                </Link>
              </li>
              <li>
                <Link
                  to="/content/$key"
                  params={{ key: "privacy" }}
                  className="focus-ring inline-flex min-h-11 items-center text-pro-14 text-muted-foreground hover:text-foreground"
                >
                  {t("profile.privacy")}
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="border-t border-border/60">
          <p className="mx-auto max-w-6xl px-5 py-5 text-pro-12 text-muted-foreground">
            © {new Date().getFullYear()} Famy. {t("site.footer.rights")}
          </p>
        </div>
      </footer>
    </div>
  );
}

/** Centered content width used by every site section. */
export function SiteSection({
  children,
  className = "",
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`mx-auto max-w-6xl px-5 ${className}`}>
      {children}
    </section>
  );
}
