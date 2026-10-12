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
  const [loadedUrl, setLoadedUrl] = useState<string>();
  const hasImage = !!url && url !== failedUrl;
  const imageLoaded = hasImage && loadedUrl === url;
  return (
    <span className={className ? `relative inline-grid shrink-0 place-items-center overflow-hidden bg-brand/10 font-extrabold text-brand ${className}` : "relative apply-avatar apply-profile-avatar"}>
      <span role={hasImage ? undefined : "img"} aria-label={hasImage ? undefined : name} aria-hidden={hasImage || undefined}>
        {Array.from(name.trim())[0] || "?"}
      </span>
      {hasImage && (
        <img ref={(image) => { if (image?.complete && image.naturalWidth > 0) setLoadedUrl(url); }} className="absolute inset-0 h-full w-full object-cover" style={{ opacity: imageLoaded ? 1 : 0 }} src={url} alt={name} onLoad={() => setLoadedUrl(url)} onError={() => setFailedUrl(url)} />
      )}
    </span>
  );
}
