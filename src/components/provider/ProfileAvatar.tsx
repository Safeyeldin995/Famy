import { useState } from "react";
import { useAvatarUrl } from "@/lib/db/queries";

export function ProfileAvatar({
  src,
  preview,
  name,
  className,
}: {
  src?: string | null;
  preview?: string | null;
  name: string;
  className?: string;
}) {
  const signed = useAvatarUrl(src);
  const url = preview || signed.data;
  const [failedUrl, setFailedUrl] = useState<string>();
  return (
    <span className={className ? `inline-grid shrink-0 place-items-center overflow-hidden bg-brand/10 font-extrabold text-brand ${className}` : "apply-avatar apply-profile-avatar"}>
      {url && url !== failedUrl ? (
        <img className="h-full w-full object-cover" src={url} alt={name} onError={() => setFailedUrl(url)} />
      ) : (
        <span role="img" aria-label={name}>
          {Array.from(name.trim())[0] || "?"}
        </span>
      )}
    </span>
  );
}
