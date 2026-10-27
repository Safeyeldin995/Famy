import { colors } from "../theme";

/** Same tone mapping and alpha values as web Bookings + StatusPill. */
export function bookingStatusStyle(status: string) {
  if (status === "completed") return { backgroundColor: "#1F9D6326", color: colors.success };
  if (["pending", "completion_requested", "disputed"].includes(status))
    return { backgroundColor: "#F10E721A", color: colors.brand };
  if (
    ["confirmed", "on_the_way", "arrived", "arrival_confirmed", "in_progress", "upcoming"].includes(
      status,
    )
  )
    return { backgroundColor: "#2A1E251A", color: colors.ink };
  return { backgroundColor: colors.surface2, color: colors.muted };
}
