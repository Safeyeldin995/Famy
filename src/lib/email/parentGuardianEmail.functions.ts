import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { sendParentGuardianEmail } from "@/lib/email/parentGuardianEmail.server";

const SendParentGuardianEmailSchema = z.object({
  parentEmail: z.string().email(),
  studentName: z.string().min(1),
  flagToken: z.string().uuid(),
  appDownloadUrl: z.string().url().optional(),
});

export const sendParentGuardianEmailFn = createServerFn({ method: "POST" })
  .validator((data) => SendParentGuardianEmailSchema.parse(data))
  .handler(async ({ data }) => {
    return sendParentGuardianEmail({
      parentEmail: data.parentEmail,
      studentName: data.studentName,
      flagToken: data.flagToken,
      appDownloadUrl: data.appDownloadUrl ?? "",
    });
  });