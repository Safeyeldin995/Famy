import { Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import { Calendar, Mic, Video, PhoneOff } from "lucide-react";
import { OnlineWebSignIn } from "@/components/online/OnlineWebSignIn";
import { ProviderCard } from "@/components/famio/ProviderCard";
import { PrimaryButton, SegmentedControl, StatusPill } from "@/components/famio/ui";
import { ProfileAvatar } from "@/components/provider/ProfileAvatar";
import { setLanguage } from "@/lib/i18n";
import type { OnlineWalkthroughScene } from "@/lib/preview/onlineWalkthroughConstants";
import { ONLINE_WALKTHROUGH_TUTOR } from "@/lib/preview/onlineWalkthroughConstants";
import { ONLINE_WEB_ROUTE_IDS, ONLINE_WEB_WALLET_TERMS_AR } from "@/lib/web/onlineWebSurface";
import { formatEGP } from "@/lib/format";
import { ICON_STROKE } from "@/lib/icons/constants";

const MOCK_PROVIDER = {
  id: ONLINE_WALKTHROUGH_TUTOR.id,
  name: ONLINE_WALKTHROUGH_TUTOR.name,
  bio: ONLINE_WALKTHROUGH_TUTOR.bio,
  hourlyRate: ONLINE_WALKTHROUGH_TUTOR.price,
  rating: ONLINE_WALKTHROUGH_TUTOR.rating,
  reviews: ONLINE_WALKTHROUGH_TUTOR.reviews,
  avatar: ONLINE_WALKTHROUGH_TUTOR.avatar,
  categorySlugs: ["tutoring"],
  distance: 0,
  badges: [],
  responseTime: 5,
};

export function OnlineWebWalkthroughScene({ scene }: { scene: OnlineWalkthroughScene }) {
  useEffect(() => {
    setLanguage("ar");
  }, []);

  switch (scene) {
    case "student-home":
      return <StudentHome />;
    case "student-sign-in":
      return <OnlineWebSignIn returnTo={ONLINE_WEB_ROUTE_IDS.tutors} />;
    case "student-tutors":
      return <StudentTutors />;
    case "student-tutor-profile":
      return <StudentTutorProfile />;
    case "student-lessons-requested":
      return <StudentLessons variant="requested" />;
    case "student-lessons-pay":
      return <StudentLessons variant="pay" />;
    case "student-lessons-join":
      return <StudentLessons variant="join" />;
    case "student-payment":
      return <StudentPayment />;
    case "student-wallet":
      return <StudentWallet />;
    case "student-room":
      return <LessonRoom role="student" />;
    case "teacher-requests":
      return <TeacherRequests />;
    case "teacher-lessons":
      return <TeacherLessons />;
    case "teacher-room":
      return <LessonRoom role="teacher" />;
    default:
      return <StudentHome />;
  }
}

function StudentHome() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-lg space-y-8 rounded-3xl bg-white p-8 shadow-sm">
      <h1 className="text-pro-28 font-extrabold text-foreground">{t("onlineWeb.home.title")}</h1>
      <p className="text-pro-15 leading-relaxed text-muted-foreground">{t("onlineWeb.home.lead")}</p>
      <div className="flex flex-wrap gap-3">
        <PrimaryButton className="h-12 px-6">{t("onlineWeb.home.browseTutors")}</PrimaryButton>
        <Link
          to={ONLINE_WEB_ROUTE_IDS.login}
          search={{ returnTo: undefined }}
          className="inline-flex h-12 items-center px-2 font-bold text-brand"
        >
          {t("onlineWeb.home.signIn")}
        </Link>
      </div>
      <p className="text-pro-13 text-muted-foreground">{ONLINE_WEB_WALLET_TERMS_AR}</p>
    </div>
  );
}

function StudentTutors() {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-pro-24 font-extrabold">{t("onlineWeb.tutors.title")}</h1>
        <p className="mt-2 text-pro-14 text-muted-foreground">{t("onlineWeb.tutors.lead")}</p>
      </header>
      <ul className="grid gap-4 sm:grid-cols-2">
        <li>
          <ProviderCard p={MOCK_PROVIDER as never} categoryLabel={t("roles.tutor")} />
        </li>
        <li>
          <ProviderCard
            p={{ ...MOCK_PROVIDER, id: "walkthrough-tutor-2", name: "أ. يوسف إبراهيم" } as never}
            categoryLabel={t("roles.tutor")}
          />
        </li>
      </ul>
    </div>
  );
}

function StudentTutorProfile() {
  const { t } = useTranslation();
  const ui = ONLINE_WALKTHROUGH_TUTOR;
  return (
    <div className="space-y-6 rounded-3xl bg-white p-6 shadow-sm">
      <div className="flex items-start gap-4">
        <ProfileAvatar src={ui.avatar} name={ui.name} className="h-20 w-20 rounded-2xl text-pro-20" />
        <div>
          <h1 className="text-pro-22 font-extrabold">{ui.name}</h1>
          <p className="mt-1 text-pro-14 text-muted-foreground">
            {t("onlineWeb.profile.reviews", { count: ui.reviews })}
          </p>
        </div>
      </div>
      <p className="text-pro-15 leading-relaxed">{ui.bio}</p>
      <PrimaryButton className="h-12 w-full">{t("onlineWeb.walkthrough.requestLesson")}</PrimaryButton>
    </div>
  );
}

function StudentLessons({ variant }: { variant: "requested" | "pay" | "join" }) {
  const { t } = useTranslation();
  const pill =
    variant === "requested"
      ? t("onlineWeb.walkthrough.statusRequested")
      : variant === "pay"
        ? t("onlineWeb.walkthrough.statusPay")
        : t("onlineWeb.walkthrough.statusJoin");
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-pro-24 font-extrabold">{t("onlineWeb.lessons.title")}</h1>
        <p className="mt-2 text-pro-14 text-muted-foreground">{t("onlineWeb.lessons.lead")}</p>
      </header>
      <SegmentedControl
        value="upcoming"
        onChange={() => {}}
        options={[
          { value: "upcoming", label: t("onlineWeb.lessons.upcoming") },
          { value: "past", label: t("onlineWeb.lessons.past") },
        ]}
      />
      <LessonRow pill={pill} showPay={variant === "pay"} showJoin={variant === "join"} />
      {variant === "pay" ? (
        <Timeline hint={t("onlineWeb.walkthrough.payCountdown", { time: "01:42:15" })} />
      ) : null}
    </div>
  );
}

function LessonRow({
  pill,
  showPay,
  showJoin,
}: {
  pill: string;
  showPay?: boolean;
  showJoin?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-2xl border border-border/60 bg-white p-4 shadow-sm">
      <StatusPill tone="brand">{pill}</StatusPill>
      <p className="mt-2 text-pro-16 font-bold">{ONLINE_WALKTHROUGH_TUTOR.name}</p>
      <p className="mt-1 flex items-center gap-1.5 text-pro-13 text-muted-foreground">
        <Calendar className="h-4 w-4" strokeWidth={ICON_STROKE} aria-hidden />
        الأربع ٤ ديسمبر · ٦:٠٠ م
      </p>
      {showPay ? (
        <PrimaryButton className="mt-4 h-11 w-full">{t("onlineWeb.walkthrough.payNow")}</PrimaryButton>
      ) : null}
      {showJoin ? (
        <PrimaryButton className="mt-4 h-11 w-full">{t("onlineWeb.walkthrough.joinNow")}</PrimaryButton>
      ) : null}
    </div>
  );
}

function Timeline({ hint }: { hint: string }) {
  return (
    <div className="rounded-2xl border border-brand/20 bg-brand/5 px-4 py-3 text-pro-13 font-semibold text-brand">
      {hint}
    </div>
  );
}

function StudentPayment() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-md space-y-5 rounded-3xl bg-white p-8 shadow-sm">
      <h1 className="text-pro-22 font-extrabold">{t("onlineWeb.walkthrough.checkoutTitle")}</h1>
      <div className="rounded-2xl bg-surface-2 p-4 text-pro-14">
        <p>{t("onlineWeb.walkthrough.walletApplied", { amount: formatEGP(80, undefined, "ar") })}</p>
        <p className="mt-2 font-bold">
          {t("onlineWeb.walkthrough.cardRemainder", { amount: formatEGP(170, undefined, "ar") })}
        </p>
      </div>
      <p className="rounded-2xl bg-surface-2 px-3 py-2 text-pro-12 font-semibold text-muted-foreground">
        {t("onlineWeb.cancelPolicy.body")}
      </p>
      <PrimaryButton className="h-12 w-full">{t("onlineWeb.walkthrough.confirmPay")}</PrimaryButton>
      <p className="text-pro-12 text-muted-foreground">{t("onlineWeb.walkthrough.refundNote")}</p>
    </div>
  );
}

function StudentWallet() {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <div className="rounded-3xl bg-white p-8 shadow-sm">
        <p className="text-pro-14 font-bold text-muted-foreground">{t("onlineWeb.wallet.balanceLabel")}</p>
        <p className="mt-2 text-pro-32 font-extrabold tabular-nums">{formatEGP(120, undefined, "ar")}</p>
      </div>
      <p className="text-pro-13 leading-relaxed text-muted-foreground">{ONLINE_WEB_WALLET_TERMS_AR}</p>
      <ul className="divide-y divide-border/60 rounded-2xl border border-border/60 bg-white">
        <li className="flex justify-between gap-3 px-4 py-3 text-pro-14">
          <span>{t("onlineWeb.wallet.reason.checkout_spend")}</span>
          <span className="font-bold">-{formatEGP(80, undefined, "ar")}</span>
        </li>
        <li className="flex justify-between gap-3 px-4 py-3 text-pro-14">
          <span>{t("onlineWeb.wallet.reason.provider_cancelled")}</span>
          <span className="font-bold text-brand">+{formatEGP(200, undefined, "ar")}</span>
        </li>
      </ul>
    </div>
  );
}

function TeacherRequests() {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <h1 className="text-pro-24 font-extrabold">{t("onlineWeb.walkthrough.providerRequestsTitle")}</h1>
      <RequestCard student="عمر" subject="رياضيات — إعدادي" />
    </div>
  );
}

function RequestCard({ student, subject }: { student: string; subject: string }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-2xl border border-border/60 bg-white p-4 shadow-sm">
      <p className="text-pro-16 font-bold">{student}</p>
      <p className="text-pro-13 text-muted-foreground">{subject}</p>
      <p className="mt-1 text-pro-13 text-muted-foreground">الخميس ٥ ديسمبر · ٥:٠٠ م</p>
      <div className="mt-4 flex gap-2">
        <PrimaryButton className="h-11 flex-1">{t("onlineWeb.walkthrough.accept")}</PrimaryButton>
        <button
          type="button"
          className="h-11 flex-1 rounded-2xl border border-border text-pro-14 font-bold"
        >
          {t("onlineWeb.walkthrough.decline")}
        </button>
      </div>
    </div>
  );
}

function TeacherLessons() {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <h1 className="text-pro-24 font-extrabold">{t("onlineWeb.providerLessons.title")}</h1>
      <LessonRow pill={t("onlineWeb.walkthrough.statusJoin")} showJoin />
    </div>
  );
}

function LessonRoom({ role }: { role: "student" | "teacher" }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-[70vh] flex-col rounded-3xl bg-navy text-white">
      <Panel className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
        <ProfileAvatar
          src={ONLINE_WALKTHROUGH_TUTOR.avatar}
          name={role === "student" ? ONLINE_WALKTHROUGH_TUTOR.name : "عمر"}
          className="h-24 w-24 rounded-2xl"
        />
        <p className="text-pro-15 font-bold">{t("onlineWeb.walkthrough.roomLive")}</p>
      </Panel>
      <Panel className="flex items-center justify-center gap-4 border-t border-white/10 p-4">
        <RoomControl icon={Mic} label={t("onlineSession.unmute")} />
        <RoomControl icon={Video} label={t("onlineSession.cameraOn")} />
        <RoomControl icon={PhoneOff} label={t("onlineSession.leave")} danger />
      </Panel>
    </div>
  );
}

function RoomControl({
  icon: Icon,
  label,
  danger,
}: {
  icon: typeof Mic;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={`flex flex-col items-center gap-1 rounded-2xl px-4 py-2 text-pro-11 font-bold ${
        danger ? "bg-destructive text-white" : "bg-white/15"
      }`}
    >
      <Icon className="h-5 w-5" aria-hidden />
      {label}
    </button>
  );
}

function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={className}>{children}</div>;
}