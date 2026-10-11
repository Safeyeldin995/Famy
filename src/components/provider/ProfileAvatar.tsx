import { useState } from "react";
import { useAvatarUrl } from "@/lib/db/queries";

export function ProfileAvatar({
  src,
  preview,
  name,
}: {
  src?: string | null;
  preview?: string | null;
  name: string;
}) {
  const signed = useAvatarUrl(src);
  const url = preview || signed.data;
  const [failedUrl, setFailedUrl] = useState<string>();
  return (
    <span className="apply-avatar apply-profile-avatar">
      {url && url !== failedUrl ? (
        <img src={url} alt={name} onError={() => setFailedUrl(url)} />
      ) : (
        <span role="img" aria-label={name}>
          {Array.from(name.trim())[0]}
        </span>
      )}
    </span>
  );
}
