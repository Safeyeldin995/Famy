/** Issue #68 harness: block TanStack Start server entry points in the browser bundle. */
export function createServerFn() {
  return () => {
    throw new Error("issue68-host: createServerFn is not available in the mocked browser harness");
  };
}

export function createMiddleware() {
  return () => undefined;
}

export function createStart() {
  return {};
}
