/** Preview hub screen registry — grouped for /preview hub navigation. */
export type PreviewScreen = {
  to: string;
  labelKey: string;
  fallback?: string;
};

export const PREVIEW_SCREEN_GROUPS: { titleKey: string; titleFallback: string; screens: PreviewScreen[] }[] = [
  {
    titleKey: "preview.groupLaunch",
    titleFallback: "Launch & sign-up",
    screens: [
      { to: "/preview/splash", labelKey: "preview.splash", fallback: "Splash animation" },
      { to: "/preview/onboarding", labelKey: "onboarding.slide1Title", fallback: "Onboarding" },
      { to: "/preview/login", labelKey: "auth.signIn", fallback: "Sign in / sign up" },
      { to: "/preview/otp", labelKey: "auth.verifyTitle", fallback: "OTP verification" },
      { to: "/preview/setup", labelKey: "setup.title", fallback: "Profile setup" },
      { to: "/preview/forgot", labelKey: "auth.forgotTitle", fallback: "Forgot password" },
    ],
  },
  {
    titleKey: "preview.groupDiscover",
    titleFallback: "Discover & book",
    screens: [
      { to: "/preview/home", labelKey: "nav.home" },
      { to: "/preview/search", labelKey: "search.title" },
      { to: "/preview/category/home-cleaning", labelKey: "categories.homeTitle" },
      { to: "/preview/provider/p1", labelKey: "providerProfile.about" },
      { to: "/preview/book/p1", labelKey: "providerProfile.bookWith", fallback: "Book a pro" },
    ],
  },
  {
    titleKey: "preview.groupTabs",
    titleFallback: "Main tabs",
    screens: [
      { to: "/preview/bookings", labelKey: "bookings.title" },
      { to: "/preview/messages", labelKey: "messages.title" },
      { to: "/preview/chat/conv-1", labelKey: "messages.title", fallback: "Chat thread" },
      { to: "/preview/profile", labelKey: "profile.title" },
    ],
  },
  {
    titleKey: "preview.groupAccount",
    titleFallback: "Account & settings",
    screens: [
      { to: "/preview/favorites", labelKey: "profile.favorites" },
      { to: "/preview/addresses", labelKey: "addresses.title" },
      { to: "/preview/family-members", labelKey: "familyMembers.title", fallback: "Family members" },
      { to: "/preview/notifications", labelKey: "common.notifications" },
      { to: "/preview/notification-preferences", labelKey: "notificationPreferences.title", fallback: "Notification preferences" },
      { to: "/preview/help", labelKey: "helpC.title" },
      { to: "/preview/promo-codes", labelKey: "promoCodes.title" },
    ],
  },
];
