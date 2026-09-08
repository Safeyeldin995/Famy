import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PhoneFrame, PrimaryButton } from "@/components/famio/ui";
import { LanguageToggle } from "@/components/famio/LanguageToggle";
import { FamyWordmark } from "@/components/famio/FamyWordmark";
import { useApp } from "@/lib/store";
import { previewPath } from "@/lib/preview/previewPath";
import slide1Img from "@/assets/onboarding/slide-1-trusted.png";
import slide2Img from "@/assets/onboarding/slide-2-booking.png";
import slide3Img from "@/assets/onboarding/slide-3-peace.png";

export const Route = createFileRoute("/onboarding")({ component: Onboarding });

const SLIDES = [
  { image: slide1Img, titleKey: "onboarding.slide1Title", bodyKey: "onboarding.slide1Body" },
  { image: slide2Img, titleKey: "onboarding.slide2Title", bodyKey: "onboarding.slide2Body" },
  { image: slide3Img, titleKey: "onboarding.slide3Title", bodyKey: "onboarding.slide3Body" },
] as const;

function formatPageNumber(value: number, lang: string) {
  return lang === "ar" ? value.toLocaleString("ar-EG") : String(value);
}

function Onboarding() {
  const [i, setI] = useState(0);
  const nav = useNavigate();
  const { setOnboarded } = useApp();
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "ar" ? "ar" : "en";

  const last = i === SLIDES.length - 1;
  const slide = SLIDES[i];

  const finish = () => {
    setOnboarded(true);
    nav({ to: previewPath("/login") });
  };

  return (
    <PhoneFrame bg="bg-white">
      <div className="safe-top flex min-h-0 flex-1 flex-col px-5 pb-4">
        <header className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 py-3">
          <button
            type="button"
            onClick={finish}
            className="focus-ring justify-self-start text-sm font-extrabold text-brand"
          >
            {t("onboarding.skip")}
          </button>
          <FamyWordmark size="compact" className="!h-10 max-w-[7.5rem] justify-self-center" />
          <div className="justify-self-end">
            <LanguageToggle variant="inline" />
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col items-center justify-center py-2">
          <img
            src={slide.image}
            alt=""
            className="max-h-[min(42vh,22rem)] w-full max-w-[20rem] object-contain"
          />
        </div>

        <div className="shrink-0 text-center">
          <h1 className="text-[1.5rem] font-extrabold leading-tight text-foreground">
            {t(slide.titleKey)}
          </h1>
          <p className="mx-auto mt-3 max-w-xs text-sm font-semibold leading-relaxed text-muted-foreground">
            {t(slide.bodyKey)}
          </p>
        </div>

        <div className="safe-bottom mt-6 shrink-0 pt-2">
          <div className="mb-3 flex justify-center gap-2" dir={lang === "ar" ? "rtl" : "ltr"}>
            {SLIDES.map((_, idx) => (
              <span
                key={idx}
                aria-hidden="true"
                className={`h-2 rounded-full transition-all ${
                  idx === i ? "w-8 bg-brand" : "w-2 bg-border"
                }`}
              />
            ))}
          </div>
          <p className="mb-4 text-center text-xs font-semibold text-muted-foreground">
            {t("onboarding.pageOf", {
              current: formatPageNumber(i + 1, lang),
              total: formatPageNumber(SLIDES.length, lang),
            })}
          </p>
          <PrimaryButton onClick={() => (last ? finish() : setI(i + 1))} className="h-14 w-full">
            {last ? t("common.getStarted") : t("common.continue")}
          </PrimaryButton>
        </div>
      </div>
    </PhoneFrame>
  );
}
