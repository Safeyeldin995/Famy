/** A saved price is never changed implicitly; only an explicit draft gets a Save action. */
export function profilePriceDirty(draft: number | undefined, saved: number | null | undefined) {
  return draft !== undefined && draft !== saved;
}
