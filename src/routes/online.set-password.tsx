import { createFileRoute, redirect } from "@tanstack/react-router";
import { otpService } from "@/lib/otp/OtpService";
import { SetPasswordScreen } from "@/routes/auth.set-password";
import { consumeOnlineWebReturnTo } from "@/lib/web/onlineWebReturnTo";

export const Route = createFileRoute("/online/set-password")({
  beforeLoad: async () => {
    const context = await otpService.getSetPasswordContext();
    if (!context.ok) {
      throw redirect({ to: "/online/login", search: { returnTo: undefined }, replace: true });
    }
    return { setPasswordContext: context };
  },
  component: OnlineSetPassword,
});

function OnlineSetPassword() {
  const { setPasswordContext } = Route.useRouteContext();
  return (
    <SetPasswordScreen
      setPasswordContext={setPasswordContext}
      customerSuccessPath={consumeOnlineWebReturnTo()}
    />
  );
}