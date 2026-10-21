import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Redirect } from "expo-router";
import { resolveWorkspace, useSession, type Workspace } from "@/lib/session";
import { colors } from "@/ui/theme";

/** Entry: send signed-out users to login and signed-in users to their workspace. */
export default function Index() {
  const { session, ready } = useSession();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    resolveWorkspace(session.user.id).then((r) => {
      if (!cancelled) setWorkspace(r.workspace);
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  if (!ready || (session && !workspace)) {
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
  if (!session) return <Redirect href="/login" />;
  if (workspace === "customer") return <Redirect href="/home" />;
  if (workspace === "provider") return <Redirect href="/dashboard" />;
  return <Redirect href="/workspace-on-web" />;
}
