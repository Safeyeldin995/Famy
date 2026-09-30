/** Issue #68 harness: stub TanStack Start server helpers for client-only Vite dev. */
export function getRequest() {
  return new Request("http://127.0.0.1/");
}

export function getCookie(_name: string) {
  return undefined;
}

export function setCookie(_name: string, _value: string) {}

export function deleteCookie(_name: string) {}
