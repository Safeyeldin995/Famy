export type PackageService = {
  pricing_model?: string | null;
  duration_min?: number | null;
  fixed_start_time?: string | null;
};

export function isFixedPackage(service: PackageService | null | undefined) {
  return service?.pricing_model === "fixed";
}

export function serviceQuote(
  service: PackageService | null | undefined,
  rate: number,
  hourlyDuration: number,
) {
  const fixed = isFixedPackage(service);
  return {
    durationMinutes: fixed ? (service?.duration_min ?? 0) : hourlyDuration * 60,
    subtotal: fixed ? rate : rate * hourlyDuration,
  };
}

export function packageLabel(service: PackageService) {
  const hours = (service.duration_min ?? 0) / 60;
  const start = service.fixed_start_time?.slice(0, 5);
  if (start === "18:00" && hours === 6) return { key: "packages.overnight", values: {} };
  if (!start && hours === 8) return { key: "packages.fullDay", values: {} };
  return {
    key: start ? "packages.timed" : "packages.continuous",
    values: { hours, start, end: packageEndTime(service) },
  };
}

export function servicePriceUnit(service: PackageService) {
  if (!isFixedPackage(service)) return { key: "pricePicker.hourUnit", values: {} };
  const label = packageLabel(service);
  return { key: `${label.key}Unit`, values: label.values };
}

export function packageEndTime(service: PackageService) {
  const [hours, minutes] = (service.fixed_start_time ?? "00:00").split(":").map(Number);
  const end = hours * 60 + minutes + (service.duration_min ?? 0);
  return `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
}

/** A chosen calendar date denotes Cairo's date for fixed packages, even on a device abroad. */
export function cairoWallTime(date: Date, time: string): Date {
  const [hour, minute] = time.split(":").map(Number);
  const wall = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute);
  let instant = wall;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (let pass = 0; pass < 3; pass++) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(instant)).map((p) => [p.type, p.value]),
    );
    const represented = Date.UTC(
      +parts.year,
      +parts.month - 1,
      +parts.day,
      +parts.hour,
      +parts.minute,
      +parts.second,
    );
    instant += wall - represented;
  }
  return new Date(instant);
}

export function filterFixedStartSlots<T extends { start: Date }>(
  slots: T[],
  service: PackageService | null | undefined,
): T[] {
  if (!isFixedPackage(service) || !service?.fixed_start_time) return slots;
  const time = service.fixed_start_time.slice(0, 5);
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Cairo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return slots.filter(
    (slot) => formatter.format(slot.start) === time && slot.start.getSeconds() === 0,
  );
}

/** Align the slot grid to a package's fixed start, rather than to rule.start_time. */
export function packageRuleStart(ruleStart: string, fixedStart?: string | null): string | null {
  if (!fixedStart) return ruleStart;
  return fixedStart.slice(0, 5) >= ruleStart.slice(0, 5) ? fixedStart : null;
}
