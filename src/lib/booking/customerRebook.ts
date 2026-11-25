export type RebookBooking = {
  id: string;
  provider_id: string;
  status: string;
  service_mode?: string | null;
};

/** «Book again» is only for finished or cancelled journeys, not active ones. */
export function shouldShowCustomerRebook(status: string | null | undefined): boolean {
  return status === "completed" || status === "cancelled";
}

export function customerRebookParams(booking: RebookBooking): {
  providerId: string;
  rebookFrom: string;
  serviceMode?: "online";
} {
  const params: {
    providerId: string;
    rebookFrom: string;
    serviceMode?: "online";
  } = {
    providerId: booking.provider_id,
    rebookFrom: booking.id,
  };
  if (booking.service_mode === "online") params.serviceMode = "online";
  return params;
}