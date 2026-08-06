/** Network-free behavioral security assertion contracts for integration tests. */

export const PERMISSION_DENIED_CODE = "42501";

export type PostgrestLikeError = {
  code?: string | null;
  message?: string | null;
} | null;

export function isPermissionDeniedError(error: PostgrestLikeError): boolean {
  return error?.code === PERMISSION_DENIED_CODE;
}

export function assertRowsOwnedByUser<T extends { user_id: string }>(
  rows: T[] | null | undefined,
  userId: string,
): boolean {
  if (!rows?.length) return false;
  return rows.every((row) => row.user_id === userId);
}

export function assertNoRowReturned(data: unknown): boolean {
  return data === null;
}

export function assertDirectInsertDenied(params: {
  error: PostgrestLikeError;
  data: unknown;
  rowCountBefore: number | null;
  rowCountAfter: number | null;
}): { ok: boolean; reason?: string } {
  if (!isPermissionDeniedError(params.error)) {
    return {
      ok: false,
      reason: `expected permission denied (${PERMISSION_DENIED_CODE}), got ${params.error?.code ?? "no error"}`,
    };
  }
  if (params.data !== null && !(Array.isArray(params.data) && params.data.length === 0)) {
    return { ok: false, reason: "expected no inserted row payload" };
  }
  if (
    params.rowCountBefore !== null
    && params.rowCountAfter !== null
    && params.rowCountBefore !== params.rowCountAfter
  ) {
    return { ok: false, reason: "row count changed after rejected insert" };
  }
  return { ok: true };
}

export function adminCountMatchesBaseline(before: number, after: number): boolean {
  return before === after;
}
