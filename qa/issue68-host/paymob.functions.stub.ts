/** Issue 68 harness stub: real Paymob server functions pull TanStack Start. */
export async function createPaymobCheckoutFn(): Promise<never> {
  throw new Error("issue68-host: Paymob checkout is stubbed in the mocked browser harness");
}

export async function getPaymobIntegrationStatusFn() {
  return { configured: false };
}
