export type ProviderPerformanceStats = {
  days?: number;
  request_count?: number;
  acceptance_rate?: number | null;
  provider_cancellation_rate?: number | null;
  completion_rate?: number | null;
  median_response_minutes?: number | null;
  rating_avg?: number | null;
  rating_count?: number;
};

export function parseProviderPerformanceStats(raw: unknown): ProviderPerformanceStats {
  if (!raw || typeof raw !== "object") return {};
  const row = raw as Record<string, unknown>;
  return {
    days: typeof row.days === "number" ? row.days : undefined,
    request_count: typeof row.request_count === "number" ? row.request_count : undefined,
    acceptance_rate: row.acceptance_rate === null ? null : Number(row.acceptance_rate),
    provider_cancellation_rate:
      row.provider_cancellation_rate === null ? null : Number(row.provider_cancellation_rate),
    completion_rate: row.completion_rate === null ? null : Number(row.completion_rate),
    median_response_minutes:
      row.median_response_minutes === null ? null : Number(row.median_response_minutes),
    rating_avg: row.rating_avg === null ? null : Number(row.rating_avg),
    rating_count: typeof row.rating_count === "number" ? row.rating_count : undefined,
  };
}

/** Returns an i18n key + params for one gentle coaching tip when a metric is weak. */
export function providerPerformanceTipKey(
  stats: ProviderPerformanceStats,
): { key: string; params?: Record<string, number> } | null {
  const acceptance = stats.acceptance_rate;
  if (acceptance != null && Number.isFinite(acceptance) && acceptance < 75) {
    return { key: "proPerformance.tipAcceptance", params: { rate: Math.round(acceptance) } };
  }
  const response = stats.median_response_minutes;
  if (response != null && Number.isFinite(response) && response > 60) {
    return { key: "proPerformance.tipResponse", params: { minutes: Math.round(response) } };
  }
  const completion = stats.completion_rate;
  if (completion != null && Number.isFinite(completion) && completion < 85) {
    return { key: "proPerformance.tipCompletion", params: { rate: Math.round(completion) } };
  }
  const cancel = stats.provider_cancellation_rate;
  if (cancel != null && Number.isFinite(cancel) && cancel > 10) {
    return { key: "proPerformance.tipCancellation", params: { rate: Math.round(cancel) } };
  }
  const rating = stats.rating_avg;
  if (rating != null && Number.isFinite(rating) && rating < 4 && (stats.rating_count ?? 0) >= 3) {
    return { key: "proPerformance.tipRating", params: { rating: Math.round(rating * 10) / 10 } };
  }
  return null;
}