import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import type { QueryClient } from "@tanstack/react-query";

/** One listener per browser query client; never await auth work in the callback. */
export function createSessionQueryIsolation(client: QueryClient, remount: () => void) {
  let previousUserId: string | null | undefined;
  return (event: AuthChangeEvent, session: Session | null) => {
    const userId = session?.user.id ?? null;
    // The first event (INITIAL_SESSION on load) only records who is signed in:
    // the cache was built for that same session, so wiping and remounting the
    // whole tree on every page load would just flicker and refetch.
    if (previousUserId === undefined) {
      previousUserId = userId;
      return;
    }
    if (userId !== previousUserId || event === "SIGNED_OUT") {
      previousUserId = userId;
      // Cancellation is initiated synchronously. Clear immediately, so no old
      // data can render while cancellation settles. Detached requests cannot
      // repopulate the new cache. Remount observers that still hold old data.
      void client.cancelQueries();
      client.clear();
      remount();
      return;
    }
    if (event === "USER_UPDATED") {
      void client.invalidateQueries({ queryKey: ["my-role"] });
      void client.invalidateQueries({ queryKey: ["my-provider"] });
      void client.invalidateQueries({ queryKey: ["my-profile"] });
    }
  };
}
