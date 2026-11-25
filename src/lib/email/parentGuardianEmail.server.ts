type SendParentGuardianEmailInput = {
  parentEmail: string;
  studentName: string;
  flagToken: string;
  appDownloadUrl: string;
};

function flagUrl(flagToken: string, siteOrigin: string) {
  const base = siteOrigin.replace(/\/$/, "");
  return `${base}/parent-guardian/flag?token=${encodeURIComponent(flagToken)}`;
}

export async function sendParentGuardianEmail(
  input: SendParentGuardianEmailInput,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, reason: "RESEND_API_KEY is not configured" };
  }

  const from = process.env.RESEND_FROM_EMAIL?.trim() || "Famy <notifications@famy.app>";
  const siteOrigin =
    process.env.PUBLIC_SITE_URL?.trim() ||
    process.env.VERCEL_URL?.trim()?.replace(/^/, "https://") ||
    "https://famy-chi.vercel.app";
  const flagLink = flagUrl(input.flagToken, siteOrigin);
  const download = input.appDownloadUrl || `${siteOrigin.replace(/\/$/, "")}/download`;

  const subject = `${input.studentName} — online lessons on Famy`;
  const html = `
    <div dir="rtl" style="font-family: system-ui, sans-serif; max-width: 520px; margin: 0 auto;">
      <p>مرحبا،</p>
      <p><strong>${input.studentName}</strong> سجل بياناتك كولي امر على فامي وهيستخدم المنصة لحجز دروس اونلاين.</p>
      <p>حمل تطبيق فامي عشان تتابع دروسه ومدفوعاته:</p>
      <p><a href="${download}">${download}</a></p>
      <p>لو مش ولي أمر الطالب، اضغط هنا:</p>
      <p><a href="${flagLink}">ده مش ابني</a></p>
      <hr/>
      <div dir="ltr">
        <p>Hello,</p>
        <p><strong>${input.studentName}</strong> listed you as their guardian on Famy and books online lessons on the platform.</p>
        <p>Download Famy to follow their lessons and payments:</p>
        <p><a href="${download}">${download}</a></p>
        <p>If this is not your child:</p>
        <p><a href="${flagLink}">This is not my child</a></p>
      </div>
    </div>
  `;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.parentEmail],
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    return { ok: false, reason: `Resend error ${res.status}: ${body.slice(0, 200)}` };
  }
  return { ok: true };
}