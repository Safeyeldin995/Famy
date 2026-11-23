import { createFileRoute, redirect } from "@tanstack/react-router";
import { otpService } from "@/lib/otp/OtpService";
import { OtpScreen } from "@/routes/otp";
import { ONLINE_WEB_ROUTE_IDS } from "@/lib/web/onlineWebSurface";

export const Route = createFileRoute("/online/otp")({
  beforeLoad: async () => {
    const context = await otpService.getOtpScreenContext();
    if (!context.ok) {
      throw redirect({
        to: context.redirect === "/login" ? ONLINE_WEB_ROUTE_IDS.login : context.redirect,
        replace: true,
      });
    }
    return { otpContext: context };
  },
  component: OnlineOtp,
});

function OnlineOtp() {
  const { otpContext } = Route.useRouteContext();
  return <OtpScreen otpContext={otpContext} loginPath={ONLINE_WEB_ROUTE_IDS.login} />;
}