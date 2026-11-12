import { Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  isStarFilled,
  RATING_GOLD,
  ratingLabelKey,
  STAR_RATINGS,
  type StarRatingValue,
  starRowDirection,
} from "@/lib/ui/starRating";
import { cn } from "@/lib/utils";

export function StarRatingInput({
  label,
  value,
  onChange,
  readOnly = false,
  className,
}: {
  label?: string;
  value: number;
  onChange?: (rating: StarRatingValue) => void;
  readOnly?: boolean;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {label ? <p className="text-sm font-bold text-foreground">{label}</p> : null}
      <div
        role="group"
        aria-label={
          value > 0
            ? t("mobileBooking.starSelectedGroup", { n: value })
            : (label ?? t("mobileBooking.rating"))
        }
      >
        <div
          className={cn(
            "flex justify-center gap-1",
            starRowDirection(i18n.language) === "row-reverse" && "flex-row-reverse",
          )}
        >
          {STAR_RATINGS.map((star) => {
            const filled = isStarFilled(star, value);
            const starLabel = t("mobileBooking.starA11y", { n: star });
            if (readOnly || !onChange) {
              return (
                <span
                  key={star}
                  className="grid h-11 w-11 place-items-center"
                  aria-hidden={!filled}
                >
                  <Star
                    className="h-9 w-9"
                    style={{
                      color: filled ? RATING_GOLD : undefined,
                      fill: filled ? RATING_GOLD : "transparent",
                    }}
                    stroke={filled ? RATING_GOLD : "var(--border)"}
                  />
                </span>
              );
            }
            return (
              <button
                type="button"
                className="focus-ring grid h-11 w-11 place-items-center"
                key={star}
                onClick={() => onChange(star)}
                aria-label={starLabel}
                aria-pressed={filled}
              >
                <Star
                  className="h-9 w-9"
                  style={{
                    color: filled ? RATING_GOLD : undefined,
                    fill: filled ? RATING_GOLD : "transparent",
                  }}
                  stroke={filled ? RATING_GOLD : "var(--border)"}
                />
              </button>
            );
          })}
        </div>
        {value > 0 ? (
          <p className="mt-2 text-center text-sm font-semibold text-foreground">
            {t(ratingLabelKey(value as StarRatingValue))}
          </p>
        ) : null}
      </div>
    </div>
  );
}
