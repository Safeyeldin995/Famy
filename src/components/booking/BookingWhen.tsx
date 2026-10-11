import { useMemo } from "react";
import { Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAvailableSlots } from "@/lib/db/queries";
import { filterFixedStartSlots, type PackageService } from "@/lib/pricing/servicePackages";
import { QueryError } from "@/components/famio/QueryError";
import type { BookSlot } from "@/components/famio/BookScheduleStep";

type Props = {
  providerId: string;
  serviceId: string;
  addressId: string | null;
  service: PackageService;
  durationMinutes: number;
  maxAdvanceDays: number;
  cairoTime: boolean;
  locale: string;
  date: Date | null;
  time: string | null;
  slots: BookSlot[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onDateChange: (date: Date) => void;
  onTimeChange: (slot: BookSlot) => void;
};

function DatePill({ day, index, ...props }: Props & { day: Date; index: number }) {
  const slots = useAvailableSlots(props.providerId, day, props.durationMinutes, {
    serviceId: props.serviceId,
    addressId: props.addressId,
    cairoTime: props.cairoTime,
    fixedStartTime: props.service.fixed_start_time,
  });
  const unavailable =
    index >= props.maxAdvanceDays ||
    (slots.isSuccess &&
      !slots.isFetching &&
      filterFixedStartSlots(slots.data ?? [], props.service).length === 0);
  const selected = props.date?.toDateString() === day.toDateString();
  return (
    <button
      type="button"
      disabled={unavailable}
      aria-pressed={selected}
      aria-label={day.toLocaleDateString(props.locale, {
        weekday: "long",
        month: "long",
        day: "numeric",
      })}
      className={`booking-date ${selected ? "on" : ""} ${unavailable ? "off" : ""}`}
      onClick={() => props.onDateChange(day)}
    >
      <small>{day.toLocaleDateString(props.locale, { weekday: "short" })}</small>
      <b>{day.toLocaleDateString(props.locale, { day: "numeric" })}</b>
    </button>
  );
}

export function BookingWhen(props: Props) {
  const { t } = useTranslation();
  const candidates = useAvailableSlots(props.providerId, props.date, props.durationMinutes, {
    serviceId: props.serviceId,
    addressId: props.addressId,
    cairoTime: props.cairoTime,
    fixedStartTime: props.service.fixed_start_time,
    includeUnavailable: true,
  });
  const displaySlots = candidates.isSuccess
    ? filterFixedStartSlots(candidates.data ?? [], props.service)
    : props.slots;

  const days = useMemo(
    () =>
      Array.from({ length: 14 }, (_, index) => {
        const date = new Date();
        date.setHours(0, 0, 0, 0);
        date.setDate(date.getDate() + index);
        return date;
      }),
    [],
  );
  const selected = props.slots.find((slot) => slot.label === props.time);
  const formatTime = (time: Date) =>
    time.toLocaleTimeString(props.locale, {
      hour: "numeric",
      minute: "2-digit",
      ...(props.cairoTime ? { timeZone: "Africa/Cairo" } : {}),
    });
  return (
    <div className="booking-section">
      <span className="apply-label">
        {(props.date ?? days[0]).toLocaleDateString(props.locale, { month: "long" })}
      </span>
      <div
        id="booking-date"
        tabIndex={-1}
        className="booking-dates"
        aria-label={t("bookFlow.datesLabel")}
      >
        {days.map((day, index) => (
          <DatePill key={day.toDateString()} day={day} index={index} {...props} />
        ))}
      </div>
      <span className="apply-label">{t("bookFlow.timesLabel")}</span>
      {props.loading ? (
        <p role="status">{t("common.loading")}</p>
      ) : props.error ? (
        <QueryError onRetry={props.onRetry} />
      ) : props.slots.length === 0 ? (
        <div className="apply-note">
          <p>{t("bookFlow.noSlots")}</p>
          <button
            type="button"
            className="booking-add"
            onClick={() => document.getElementById("booking-date")?.focus()}
          >
            {t("bookingUx.changeDate")}
          </button>
        </div>
      ) : null}
      {!props.loading && !props.error && displaySlots.length > 0 && (
        <div className="booking-times">
          {displaySlots.map((slot) => (
            <button
              type="button"
              key={slot.start.toISOString()}
              disabled={
                ("available" in slot && slot.available === false) ||
                !props.slots.some((available) => +available.start === +slot.start)
              }
              aria-pressed={props.time === slot.label}
              className={`booking-time ${props.time === slot.label ? "on" : ""}`}
              onClick={() => {
                const available = props.slots.find((item) => +item.start === +slot.start);
                if (available) props.onTimeChange(available);
              }}
            >
              {formatTime(slot.start)}
            </button>
          ))}
        </div>
      )}
      {selected && (
        <div className="booking-when">
          <Clock size={18} aria-hidden="true" />
          <span>
            {t("customerBooking.whenSummary", {
              date: props.date?.toLocaleDateString(props.locale, {
                weekday: "long",
                month: "long",
                day: "numeric",
              }),
              start: formatTime(selected.start),
              end: formatTime(selected.end),
            })}
          </span>
        </div>
      )}
    </div>
  );
}
