import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Redirect } from "expo-router";
import { customerLandingPath, resolveWorkspace, useSession, type Workspace } from "@/lib/session";
import { colors } from "@/ui/theme";
import { isOnboarded } from "@/lib/onboarding";

/** Entry: send signed-out users to login and signed-in users to their workspace. */
export default function Index() {
  const { session, ready } = useSession();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [customerPath, setCustomerPath] = useState<"/home" | "/setup" | null>(null);
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    isOnboarded().then((value) => {
      if (!cancelled) setOnboarded(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    resolveWorkspace(session.user.id).then(async (r) => {
      const path =
        r.workspace === "customer" ? await customerLandingPath(session.user.id) : "/home";
      if (cancelled) return;
      setCustomerPath(path);
      setWorkspace(r.workspace);
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  if (!ready || onboarded === null || (session && !workspace)) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.background,
        }}
      >
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  if (!session) return <Redirect href={onboarded ? "/login" : "/onboarding"} />;
  if (workspace === "customer") return <Redirect href={customerPath ?? "/home"} />;
  if (workspace === "provider") return <Redirect href="/dashboard" />;
  return <Redirect href="/workspace-on-web" />;
}
