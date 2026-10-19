export const MOCK_USER_ID = "6c1a0d3e-8b47-4f2a-9d11-2f0c6a91b704";
export const EXISTING_ADDRESS_ID = "a31f0c22-5d88-4b71-9e46-7c2d1f08e915";
export const SYNTHETIC_PUBLISHABLE_KEY = "sb_publishable_issue70_test_not_real";
export const HARNESS_HOST = "127.0.0.1";
export const DEFAULT_HARNESS_PORT = 8200;

export const EXISTING_COORDS = { lat: 29.974123, lng: 30.945678 };
export const PIN_COORDS = { lat: 30.012345, lng: 31.234567 };

export const HARNESS_RUNTIME_KEYS = [
  "PATH",
  "PATHEXT",
  "SystemRoot",
  "COMSPEC",
  "WINDIR",
  "USERPROFILE",
  "HOME",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
  "HOMEDRIVE",
  "HOMEPATH",
  "PROGRAMFILES",
  "ProgramFiles(x86)",
  "CommonProgramFiles",
  "USERNAME",
  "USERDOMAIN",
  "OS",
  "PROCESSOR_ARCHITECTURE",
];

export const TILE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

export const SSR_HYDRATION_COVERAGE = {
  covered: false,
  reason:
    "Issue 70 uses an isolated Vite SPA harness with synthetic APIs. It does not boot TanStack Start SSR, so it cannot prove server-render HTML or hydration. AuthGate's no-beforeLoad / checking-spinner contract remains a source assertion in src/routes/__tests__/setup.combined.test.ts, not a server-render browser proof.",
};
