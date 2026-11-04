import { Link } from "@tanstack/react-router";
import { LessonIllustration } from "@/components/lessons/LessonIllustration";
import { isLessonServiceSlug } from "@/lib/tutoring/lessonServices";
import { isPreviewRoute } from "@/lib/preview/constants";

type LessonService = {
  id: string;
  slug: string;
  name_en: string;
  name_ar?: string | null;
};

export function LessonServiceTileRow({
  services,
  lang,
  categorySlug = "tutoring",
  selectedServiceId,
  onSelectServiceId,
}: {
  services: LessonService[];
  lang: "ar" | "en";
  categorySlug?: string;
  selectedServiceId?: string;
  onSelectServiceId?: (serviceId: string) => void;
}) {
  const lessonServices = services.filter((row) => isLessonServiceSlug(row.slug));
  if (lessonServices.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-3">
      {lessonServices.map((service) => {
        const title = lang === "ar" ? service.name_ar || service.name_en : service.name_en;
        const selected = selectedServiceId === service.id;
        const inner = (
          <>
            <LessonIllustration
              serviceSlug={service.slug}
              label={title}
              className="h-14 w-14 shrink-0"
            />
            <span className="line-clamp-2 text-pro-13 font-extrabold leading-snug">{title}</span>
          </>
        );
        const surface = `focus-ring tap-scale flex min-h-[5.5rem] flex-col justify-between gap-2 rounded-2xl border p-3 shadow-sm ${
          selected ? "border-brand bg-brand/[0.08]" : "border-border/60 bg-white"
        }`;

        if (onSelectServiceId) {
          return (
            <button
              key={service.id}
              type="button"
              className={surface}
              aria-pressed={selected}
              onClick={() => onSelectServiceId(service.id)}
            >
              {inner}
            </button>
          );
        }

        const categoryTo = isPreviewRoute() ? "/preview/category/$id" : "/category/$id";

        return (
          <Link
            key={service.id}
            to={categoryTo}
            params={{ id: categorySlug }}
            className={surface}
          >
            {inner}
          </Link>
        );
      })}
    </div>
  );
}
