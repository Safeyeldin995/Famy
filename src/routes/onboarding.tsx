import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PhoneFrame, PrimaryButton } from "@/components/famio/ui";
import { LanguageToggle } from "@/components/famio/LanguageToggle";
import { CustomerFloatingPanel } from "@/components/famio/CustomerFloatingPanel";
import { FamyWordmark } from "@/components/famio/FamyWordmark";
import { useApp } from "@/lib/store";
import { ShieldCheck, Calendar, Heart } from "lucide-react";
import { ICON_STROKE_BOLD } from "@/lib/icons/constants";

export const Route = createFileRoute("/onboarding")({ component: Onboarding });

const SLIDE_TINTS = ["var(--sky)", "var(--mint)", "var(--lavender)"] as const;

function Onboarding() {
  const [i, setI] = useState(0);
  const nav = useNavigate();
  const { setOnboarded } = useApp();
  const { t } = useTranslation();

  const slides = [
    { icon: ShieldCheck, title: t("onboarding.slide1Title"), body: t("onboarding.slide1Body") },
    { icon: Calendar, title: t("onboarding.slide2Title"), body: t("onboarding.slide2Body") },
    { icon: Heart, title: t("onboarding.slide3Title"), body: t("onboarding.slide3Body") },
  ];
  const last = i === slides.length - 1;
  const s = slides[i];
  const Icon = s.icon;

  const finish = () => {
    setOnboarded(true);
    nav({ to: "/login" });
  };

  return (
    <PhoneFrame bg="bg-[#F10E72]">
      <div className="safe-top flex items-center justify-between px-5 py-3">
        <LanguageToggle variant="inline" />
        <button
          onClick={finish}
          className="text-sm font-extrabold text-white/80"
        >
          {t("onboarding.skip")}
        </button>
      </div>

      <header className="px-5 pb-20 pt-2 text-center">
        <FamyWordmark size="auth" variant="white" className="mx-auto" />
      </header>

      <CustomerFloatingPanel className="mx-5 -mt-10 flex flex-1 flex-col">
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <div
            className="grid h-28 w-28 place-items-center rounded-[2rem]"
            style={{ background: `${SLIDE_TINTS[i]}22` }}
          >
            <div className="grid h-20 w-20 place-items-center rounded-[1.5rem] bg-brand/10 text-brand">
              <Icon className="h-9 w-9" strokeWidth={ICON_STROKE_BOLD} aria-hidden="true" />
            </div>
          </div>
          <h1 className="mt-8 text-[1.5rem] font-extrabold leading-tight text-foreground">{s.title}</h1>
          <p className="mt-3 max-w-xs text-sm font-semibold leading-relaxed text-muted-foreground">{s.body}</p>
        </div>

        <div className="safe-bottom pt-4">
          <div className="mb-4 flex justify-center gap-2">
            {slides.map((_, idx) => (
              <span
                key={idx}
                className={`h-2 rounded-full transition-all ${idx === i ? "w-8 bg-brand" : "w-2 bg-border"}`}
              />
            ))}
          </div>
          <p className="mb-4 text-center text-xs font-semibold text-muted-foreground">
            {t("onboarding.pageOf", { current: i + 1, total: slides.length })}
          </p>
          <PrimaryButton onClick={() => (last ? finish() : setI(i + 1))} className="h-14 w-full">
            {last ? t("common.getStarted") : t("common.continue")}
          </PrimaryButton>
        </div>
      </CustomerFloatingPanel>
    </PhoneFrame>
  );
}
