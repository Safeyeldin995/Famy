import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ProfileAvatar } from "@/components/provider/ProfileAvatar";
import { supabase } from "@/integrations/supabase/client";
import { isPreviewRoute } from "@/lib/preview/constants";

export function CustomerProfilePhoto({ src, name }: { src?: string | null; name: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const upload = async (file: File) => {
    if (isPreviewRoute()) return;
    try {
      setUploading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("auth required");
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${user.id}/avatar-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("avatars").upload(path, file, { contentType: file.type, upsert: true });
      if (error) throw error;
      const result = await supabase.from("profiles").update({ avatar_url: path }).eq("id", user.id);
      if (result.error) throw result.error;
      await qc.invalidateQueries({ queryKey: ["my-profile"] });
    } catch {
      toast.error(t("setup.uploadFailed"));
    } finally {
      setUploading(false);
    }
  };
  return <div className="relative pb-2 pe-2">
    <ProfileAvatar src={src} name={name} className="h-20 w-20 rounded-full text-pro-24" />
    <button type="button" disabled={uploading} onClick={() => input.current?.click()} aria-label={t("setup.photoHint")} className="focus-ring absolute bottom-0 end-0 grid h-11 w-11 place-items-center rounded-full border-2 border-white bg-brand text-brand-foreground">
      {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
    </button>
    <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file); e.target.value = ""; }} />
  </div>;
}
