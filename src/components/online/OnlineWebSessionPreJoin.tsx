import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PrimaryButton } from "@/components/famio/ui";

export type PreJoinChoice = { audioOnly: boolean };

type Props = {
  onReady: (choice: PreJoinChoice) => void;
  onCancel: () => void;
};

export function OnlineWebSessionPreJoin({ onReady, onCancel }: Props) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cancelledRef = useRef(false);
  const [micOk, setMicOk] = useState<boolean | null>(null);
  const [camOk, setCamOk] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(true);

  const stopPreview = useCallback(() => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const probe = useCallback(async () => {
    setChecking(true);
    stopPreview();
    setMicOk(null);
    setCamOk(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      if (cancelledRef.current) {
        stream.getTracks().forEach((tr) => tr.stop());
        return;
      }
      streamRef.current = stream;
      setMicOk(true);
      setCamOk(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        void videoRef.current.play().catch(() => {});
      }
    } catch {
      try {
        const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        if (cancelledRef.current) {
          audioOnly.getTracks().forEach((tr) => tr.stop());
          return;
        }
        streamRef.current = audioOnly;
        setMicOk(true);
        setCamOk(false);
      } catch {
        if (!cancelledRef.current) {
          setMicOk(false);
          setCamOk(false);
        }
      }
    } finally {
      if (!cancelledRef.current) setChecking(false);
    }
  }, [stopPreview]);

  useEffect(() => {
    cancelledRef.current = false;
    void probe();
    return () => {
      cancelledRef.current = true;
      stopPreview();
    };
  }, [probe, stopPreview]);

  const canJoin = micOk === true;

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 rounded-3xl bg-navy p-6 text-white">
      <h2 className="text-pro-18 font-extrabold">{t("onlineSession.preJoinTitle")}</h2>
      <p className="text-pro-14 text-white/80">{t("onlineSession.preJoinHint")}</p>
      <div className="relative aspect-video overflow-hidden rounded-2xl bg-black/50">
        <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
        {camOk === false ? (
          <p className="absolute inset-0 flex items-center justify-center bg-black/60 px-4 text-center text-pro-13">
            {t("onlineSession.audioOnlyBanner")}
          </p>
        ) : null}
      </div>
      <ul className="space-y-1 text-pro-13">
        <li>
          {t("onlineSession.preJoinMic")}:{" "}
          {checking ? t("onlineSession.preJoinChecking") : micOk ? "✓" : t("onlineSession.preJoinDenied")}
        </li>
        <li>
          {t("onlineSession.preJoinCamera")}:{" "}
          {checking ? t("onlineSession.preJoinChecking") : camOk ? "✓" : t("onlineSession.preJoinDenied")}
        </li>
      </ul>
      <div className="flex flex-wrap gap-2">
        <PrimaryButton className="h-11 min-w-[8rem]" disabled={!canJoin || checking} onClick={() => onReady({ audioOnly: camOk === false })}>
          {t("onlineSession.preJoinContinue")}
        </PrimaryButton>
        {micOk && camOk === false ? (
          <button
            type="button"
            className="rounded-full border border-white/30 px-4 py-2 text-pro-13 font-bold"
            onClick={() => onReady({ audioOnly: true })}
          >
            {t("onlineWeb.session.continueAudioOnly")}
          </button>
        ) : null}
        {micOk === false ? (
          <button type="button" className="rounded-full bg-white/10 px-4 py-2 text-pro-13 font-bold" onClick={() => void probe()}>
            {t("onlineSession.retry")}
          </button>
        ) : null}
        <button type="button" className="ms-auto text-pro-13 font-bold text-white/70 underline-offset-2 hover:underline" onClick={onCancel}>
          {t("onlineSession.preJoinBack")}
        </button>
      </div>
    </div>
  );
}