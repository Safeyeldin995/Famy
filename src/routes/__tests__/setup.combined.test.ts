import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const routesDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const setupSource = readFileSync(join(routesDir, "setup.tsx"), "utf8");
const locationPickerSource = readFileSync(
  join(routesDir, "../components/famio/LocationPicker.tsx"),
  "utf8",
);
const authGateSource = readFileSync(join(routesDir, "../components/famio/AuthGate.tsx"), "utf8");

describe("combined /setup after AuthGate + coordinate merge", () => {
  it("wraps Setup in AuthGate and still mounts LocationPicker", () => {
    expect(setupSource).toContain('createFileRoute("/setup")({ component: SetupRoute })');
    expect(setupSource).toContain('import { AuthGate } from "@/components/famio/AuthGate"');
    expect(setupSource).toContain(
      'import { LocationPicker, isValidLatLng } from "@/components/famio/LocationPicker"',
    );
    expect(setupSource).toMatch(
      /function SetupRoute\(\) \{\s*return \(\s*<AuthGate>\s*<Setup \/>\s*<\/AuthGate>/,
    );
    expect(setupSource).toContain(
      "<LocationPicker value={coords} onChange={(pos) => setCoords(pos)} />",
    );
  });

  it("hydrates a valid pinned default address and sends lat/lng on create and update", () => {
    expect(setupSource).toContain(
      "if (isValidLatLng({ lat: def.lat ?? NaN, lng: def.lng ?? NaN }))",
    );
    expect(setupSource).toContain("setCoords({ lat: def.lat as number, lng: def.lng as number })");

    const updateBlock = setupSource.slice(
      setupSource.indexOf("if (existingAddressId)"),
      setupSource.indexOf("} else {"),
    );
    const createBlock = setupSource.slice(
      setupSource.indexOf("await createAddress.mutateAsync"),
      setupSource.indexOf("setProfile(form)"),
    );
    expect(updateBlock).toContain("lat: coords?.lat ?? null");
    expect(updateBlock).toContain("lng: coords?.lng ?? null");
    expect(createBlock).toContain("lat: coords?.lat ?? null");
    expect(createBlock).toContain("lng: coords?.lng ?? null");
  });

  it("keeps the pin optional and shows the existing no-coordinates warning", () => {
    const validMatch = setupSource.match(
      /const valid =\s*form\.name\.trim\(\)\.length > 1 && form\.address\.trim\(\)\.length > 2 && form\.area\.trim\(\)\.length > 0;/,
    );
    expect(validMatch?.[0]).toBeTruthy();
    expect(validMatch?.[0]).not.toContain("coords");
    expect(setupSource).toContain("!isValidLatLng(coords)");
    expect(setupSource).toContain("addresses.noCoordsWarning");
  });

  it("does not redirect during SSR and only requests geolocation from the locate button", () => {
    expect(authGateSource).toContain("useRequireAuth");
    expect(authGateSource).toContain("if (checking)");
    expect(locationPickerSource).toContain("navigator.geolocation.getCurrentPosition");
    expect(locationPickerSource).toContain("onClick={useCurrentLocation}");
    expect(locationPickerSource.match(/geolocation\.getCurrentPosition/g)).toHaveLength(1);
    expect(locationPickerSource).not.toMatch(/useEffect\([\s\S]*getCurrentPosition/);
  });
});
