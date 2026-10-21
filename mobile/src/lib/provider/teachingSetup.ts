export function missingTeachingServices<T extends { id: string; name_ar: string; name_en: string }>(
  services: T[],
  rows: { service_id: string; status: string }[],
) {
  return services.filter(
    (service) => !rows.some((row) => row.service_id === service.id && row.status !== "rejected"),
  );
}
