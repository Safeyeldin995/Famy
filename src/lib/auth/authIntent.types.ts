export type AuthFlowPurpose = "signup" | "reset";
export type AuthFlowRole = "customer" | "provider";

export type OtpScreenContext =
  | {
      ok: true;
      maskedPhone: string;
      purpose: AuthFlowPurpose;
      role?: AuthFlowRole;
      otpExpiresIn: number;
      resendAvailableIn: number;
    }
  | {
      ok: false;
      redirect: "/login" | "/auth/forgot";
    };

export type SetPasswordContext =
  | {
      ok: true;
      maskedPhone: string;
      purpose: AuthFlowPurpose;
      role?: AuthFlowRole;
    }
  | {
      ok: false;
      redirect: "/login" | "/otp";
    };
