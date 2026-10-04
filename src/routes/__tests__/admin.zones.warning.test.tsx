import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const state = vi.hoisted(() => ({
  services: [
    { id: "active", is_active: true },
    { id: "inactive", is_active: false },
  ],
  coverage: new Set<string>(),
  ready: true,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: () => "No services enabled in this zone" }),
}));
vi.mock("@/lib/db/admin-queries", () => ({
  useAdminServices: () => ({ isSuccess: state.ready, data: state.services }),
  useZoneServiceCoverage: () => ({ isSuccess: state.ready, data: state.coverage }),
}));
vi.mock("@/components/famio/LocationPicker", () => ({
  LocationPicker: () => null,
  isValidLatLng: () => false,
}));
vi.mock("@/components/famio/ZonePolygonEditor", () => ({ ZonePolygonEditor: () => null }));

import { ZoneServicesWarning } from "../admin.zones";

afterEach(() => {
  cleanup();
  state.coverage = new Set();
  state.ready = true;
});

describe("admin zone active-service warning", () => {
  it("warns when the zone has no linked services", () => {
    render(<ZoneServicesWarning zoneId="zone" />);
    expect(screen.queryByText("No services enabled in this zone")).not.toBeNull();
  });
  it("warns when every linked service is inactive", () => {
    state.coverage = new Set(["inactive"]);
    render(<ZoneServicesWarning zoneId="zone" />);
    expect(screen.queryByText("No services enabled in this zone")).not.toBeNull();
  });
  it("does not warn when a linked active service exists", () => {
    state.coverage = new Set(["inactive", "active"]);
    render(<ZoneServicesWarning zoneId="zone" />);
    expect(screen.queryByText("No services enabled in this zone")).toBeNull();
  });
  it("does not treat loading or failed queries as zero coverage", () => {
    state.ready = false;
    render(<ZoneServicesWarning zoneId="zone" />);
    expect(screen.queryByText("No services enabled in this zone")).toBeNull();
  });
});
