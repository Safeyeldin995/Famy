import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getRequestBearerToken, getRequestBearerUserId } from "@/lib/auth/requestAuth.server";
import { claimAndSendParentGuardianEmail } from "@/lib/email/parentGuardianEmailFlow.server";

const SendParentGuardianEmailSchema = z.object({
  linkId: z.string().uuid().optional(),
});

export const sendParentGuardianEmailFn = createServerFn({ method: "POST" })
  .validator((data) => SendParentGuardianEmailSchema.parse(data))
  .handler(async ({ data }) => {
    const userId = await getRequestBearerUserId();
    if (!userId) {
      return { ok: false as const, reason: "Authentication required" };
    }
    const token = getRequestBearerToken();
    if (!token) {
      return { ok: false as const, reason: "Authentication required" };
    }
    return claimAndSendParentGuardianEmail({ token, linkId: data.linkId ?? null });
  });
