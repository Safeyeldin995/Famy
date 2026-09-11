import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { PhoneFrame } from "@/components/famio/ui";
import { useRequireAuth } from "@/lib/auth/useRequireAuth";

/**
 * Renders `children` only once a signed-in session is confirmed in the browser.
 * While the session is still hydrating — and during server rendering, where it never
 * resolves — it shows a spinner instead of redirecting. See useRequireAuth.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { checking } = useRequireAuth();

  if (checking) {
    return (
      <PhoneFrame bg="bg-background">
        <div className="grid min-h-dvh place-items-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" />
        </div>
      </PhoneFrame>
    );
  }

  return <>{children}</>;
}
