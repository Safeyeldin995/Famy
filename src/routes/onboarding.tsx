import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PhoneFrame, PrimaryButton } from "@/components/famio/ui";
import { LanguageToggle } from "@/components/famio/LanguageToggle";
import { useApp } from "@/lib/store";
import { ShieldCheck, Calendar, Heart } from "lucide-react";

export const Route = createFileRoute("/onboarding")({ component: Onboarding });

function Onboarding() {
  const [i, setI] = useState(0);
  const nav = useNavigate();
  const { setOnboarded } = useApp();
  const { t } = useTranslation();

  const slides = [
    { icon: ShieldCheck, tint: "var(--sky)", title: t("onboarding.slide1Title"), body: t("onboarding.slide1Body") },
    { icon: Calendar, tint: "var(--mint)", title: t("onboarding.slide2Title"), body: t("onboarding.slide2Body") },
    { icon: Heart, tint: "var(--lavender)", title: t("onboarding.slide3Title"), body: t("onboarding.slide3Body") },
  ];
  const last = i === slides.length - 1;
  const s = slides[i];
  const Icon = s.icon;

  const finish = () => { setOnboarded(true); nav({ to: "/login" }); };

  return (
    <PhoneFrame bg="bg-surface">
      <div className="safe-top flex items-center justify-between px-5 py-3">
        <LanguageToggle variant="inline" />
        <button onClick={finish} className="text-sm font-semibold text-muted-foreground">{t("onboarding.skip")}</button>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
        <div
          className="animate-pop grid h-56 w-56 place-items-center rounded-[40%]"
          style={{ background: s.tint, opacity: 0.5 }}
        />
        <div className="-mt-44 mb-16 animate-pop">
          <div className="grid h-24 w-24 place-items-center rounded-3xl bg-surface shadow-card">
            <Icon className="h-10 w-10 text-navy" strokeWidth={2.2} />
          </div>
        </div>
        <h1 className="animate-rise text-3xl font-extrabold tracking-tight text-foreground">{s.title}</h1>
        <p className="animate-rise mt-4 max-w-xs text-[15px] leading-relaxed text-muted-foreground">{s.body}</p>
      </div>
      <div className="safe-bottom px-6 pt-6">
        <div className="mb-6 text-center text-xs font-semibold text-muted-foreground">
          {t("onboarding.pageOf", { current: i + 1, total: slides.length })}
        </div>

        <PrimaryButton onClick={() => (last ? finish() : setI(i + 1))}>
          {last ? t("common.getStarted") : t("common.continue")}
        </PrimaryButton>
      </div>
    </PhoneFrame>
  );
}
