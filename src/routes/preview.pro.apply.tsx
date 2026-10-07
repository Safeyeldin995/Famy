import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ProviderApplyFlow } from "@/components/provider/ProviderApplyFlow";
export const Route = createFileRoute("/preview/pro/apply")({ component: PreviewProviderApply });
function PreviewProviderApply() {
  const navigate = useNavigate();
  return (
    <ProviderApplyFlow
      initial={{
        name: "منى عادل",
        zones: ["zayed", "october"],
        services: ["hourly"],
        prices: { hourly: 250 },
        front: true,
        back: false,
        agreed: true,
      }}
      zones={[
        { id: "zayed", name_ar: "الشيخ زايد", name_en: "Sheikh Zayed" },
        { id: "october", name_ar: "6 أكتوبر", name_en: "6 October" },
      ]}
      services={[
        {
          id: "hourly",
          name_ar: "جليسة أطفال بالساعة",
          name_en: "Hourly babysitting",
          category: { slug: "babysitting" },
          pricing_model: "hourly",
          provider_pricing_allowed: true,
          minimum_price: 150,
          maximum_price: 500,
        },
        {
          id: "day",
          name_ar: "يوم كامل",
          name_en: "Full day",
          category: { slug: "babysitting" },
          pricing_model: "fixed",
          duration_min: 480,
          provider_pricing_allowed: true,
          minimum_price: 800,
          maximum_price: 2000,
        },
        {
          id: "homework",
          name_ar: "مساعدة في الواجبات",
          name_en: "Homework help",
          category: { slug: "tutoring" },
          pricing_model: "hourly",
          provider_pricing_allowed: true,
          minimum_price: 150,
          maximum_price: 500,
        },
      ]}
      onSave={async (step) => {
        if (step === 3) await navigate({ to: "/preview/pro", search: { pending: 1 } });
      }}
      onCapture={async () => {
        /* Preview only: no files leave the device. */
      }}
    />
  );
}
