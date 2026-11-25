export const ONLINE_WALKTHROUGH_SCENES = [
  "student-home",
  "student-sign-in",
  "student-tutors",
  "student-tutor-profile",
  "student-lessons-requested",
  "student-lessons-pay",
  "student-lessons-join",
  "student-payment",
  "student-wallet",
  "student-room",
  "teacher-requests",
  "teacher-lessons",
  "teacher-room",
] as const;

export type OnlineWalkthroughScene = (typeof ONLINE_WALKTHROUGH_SCENES)[number];

export function isOnlineWalkthroughScene(v: string): v is OnlineWalkthroughScene {
  return (ONLINE_WALKTHROUGH_SCENES as readonly string[]).includes(v);
}

export const ONLINE_WALKTHROUGH_TUTOR = {
  id: "walkthrough-tutor-1",
  name: "د. سارة محمود",
  bio: "مدرسة رياضيات أونلاين — ثانوي وإعدادي",
  rating: 4.9,
  reviews: 86,
  price: 250,
  avatar: "https://i.pravatar.cc/240?img=5",
};