import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { respondWithinLabel, type BookingExpirySettings } from "@/lib/booking/pending-expiry";
import { previewPath } from "@/lib/preview/previewPath";

export function BookAnotherProviderLink({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <Link to={previewPath("/home")} className={className} data-testid="book-another-provider">
      {t("bookingDetail.bookAnotherProvider")}
    </Link>
  );
}

export function RespondWithinHint({
  createdAt,
  startAt,
  settings,
}: {
  createdAt: Date | string;
  startAt: Date | string;
  settings?: BookingExpirySettings;
}) {
  const { t } = useTranslation();
  return (
    <p className="text-[11px] font-bold text-warning" data-testid="respond-within">
      {respondWithinLabel(createdAt, startAt, t, settings)}
    </p>
  );
}
