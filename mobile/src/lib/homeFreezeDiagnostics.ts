type HomeDiag = {
  focusEffectRuns: number;
  queryFetchStarts: Record<string, number>;
  legacyMode: boolean;
};

const KEY = "famy.homeFreezeDiag";
const LEGACY_KEY = "famy.homeFreezeLegacy";

function storageGet(key: string): string | null {
  try {
    const ls = (globalThis as { localStorage?: { getItem: (k: string) => string | null } })
      .localStorage;
    return ls?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function devBuild(): boolean {
  return typeof __DEV__ !== "undefined" && __DEV__;
}

export function homeFreezeDiagEnabled(): boolean {
  return (
    devBuild() ||
    process.env.EXPO_PUBLIC_HOME_FREEZE_DIAG === "1" ||
    storageGet(KEY) === "1"
  );
}

export function homeFreezeLegacyMode(): boolean {
  return (
    process.env.EXPO_PUBLIC_HOME_FREEZE_LEGACY === "1" ||
    storageGet(LEGACY_KEY) === "1"
  );
}

const state: HomeDiag = { focusEffectRuns: 0, queryFetchStarts: {}, legacyMode: false };

function publish() {
  if (!homeFreezeDiagEnabled()) return;
  const snapshot = { ...state, queryFetchStarts: { ...state.queryFetchStarts } };
  (globalThis as { __FAMY_HOME_DIAG__?: HomeDiag }).__FAMY_HOME_DIAG__ = snapshot;
  if (devBuild()) {
    // eslint-disable-next-line no-console
    console.info("[home-freeze-diag]", snapshot);
  }
}

export function resetHomeFreezeDiagnostics() {
  state.focusEffectRuns = 0;
  state.queryFetchStarts = {};
  state.legacyMode = homeFreezeLegacyMode();
  publish();
}

export function bumpHomeFocusEffect() {
  if (!homeFreezeDiagEnabled()) return;
  state.focusEffectRuns += 1;
  publish();
}

export function bumpHomeQueryFetch(queryKey: string) {
  if (!homeFreezeDiagEnabled()) return;
  state.queryFetchStarts[queryKey] = (state.queryFetchStarts[queryKey] ?? 0) + 1;
  publish();
}

export function readHomeFreezeDiagnostics(): HomeDiag {
  return { ...state, queryFetchStarts: { ...state.queryFetchStarts } };
}