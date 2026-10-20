import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMyBookings, useBookingParties } from "@/lib/queries";
import { activeStatuses, dateTime, localized, money } from "@/lib/presentation";
import { Page, QueryState, Row } from "@/ui/Page";
import { Segmented } from "@/ui/Segmented";

export default function Bookings() {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState("upcoming");
  const q = useMyBookings();
  const parties = useBookingParties((q.data ?? []).map((b) => b.id));
  const rows = (q.data ?? []).filter((b) =>
    tab === "upcoming"
      ? activeStatuses.includes(b.status)
      : ["completed", "cancelled", "no_show"].includes(b.status),
  );
  return (
    <Page tab title={t("bookings.title")} queries={[q, parties]}>
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "upcoming", label: t("bookings.upcoming") },
          { value: "past", label: t("mobile.past") },
        ]}
      />
      <QueryState query={q} empty={!rows.length} emptyKey="mobile.noBookings">
        <QueryState query={parties} />
        {rows.map((b) => (
          <Row
            key={b.id}
            label={
              parties.data?.get(b.id)?.other_name ||
              b.provider?.profile.full_name ||
              t("provider2.unnamed")
            }
            detail={[
              localized(b.service, i18n.language),
              t(`status.${b.status}`),
              dateTime(b.start_at, i18n.language),
              money(b.price_total, i18n.language),
            ].join(" · ")}
            href={{ pathname: "/booking/[id]", params: { id: b.id } }}
          />
        ))}
      </QueryState>
    </Page>
  );
}
