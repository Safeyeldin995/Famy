/** Preview hub screen registry — grouped for /preview hub navigation. */
export type PreviewScreen = {
  to: string;
  labelKey: string;
  fallback: string;
  descriptionKey?: string;
  descriptionFallback?: string;
  featured?: boolean;
  badge?: "new" | "updated";
};

export const PREVIEW_FEATURED: PreviewScreen[] = [
  {
    to: "/preview/splash",
    labelKey: "preview.splash",
    fallback: "Splash animation",
    descriptionKey: "preview.splashDesc",
    descriptionFallback: "Animated Famy logo on pink",
    featured: true,
  },
  {
    to: "/preview/onboarding",
    labelKey: "preview.onboarding",
    fallback: "Onboarding",
    descriptionKey: "preview.onboardingDesc",
    descriptionFallback: "3-step intro with illustrations",
    featured: true,
    badge: "updated",
  },
  {
    to: "/preview/login",
    labelKey: "preview.registration",
    fallback: "Registration",
    descriptionKey: "preview.registrationDesc",
    descriptionFallback: "Sign in & sign up — new design",
    featured: true,
  },
  {
    to: "/preview/home",
    labelKey: "nav.home",
    fallback: "Home",
    descriptionKey: "preview.homeDesc",
    descriptionFallback: "Customer home — categories & featured pros",
    featured: true,
  },
  {
    to: "/preview/provider/p1",
    labelKey: "preview.provider",
    fallback: "Provider profile",
    descriptionKey: "preview.providerDesc",
    descriptionFallback: "Pink hero, week availability & reviews",
    featured: true,
    badge: "updated",
  },
  {
    to: "/preview/book/p1",
    labelKey: "preview.booking",
    fallback: "Book a pro",
    descriptionKey: "preview.bookingDesc",
    descriptionFallback: "Merged schedule — date & time dropdowns",
    featured: true,
    badge: "updated",
  },
  {
    to: "/preview/bookings",
    labelKey: "bookings.title",
    fallback: "Bookings",
    descriptionKey: "preview.bookingsDesc",
    descriptionFallback: "Upcoming visits & history tabs",
    featured: true,
    badge: "updated",
  },
  {
    to: "/preview/addresses",
    labelKey: "addresses.title",
    fallback: "Addresses",
    descriptionKey: "preview.addressesDesc",
    descriptionFallback: "Saved places — list, add & edit",
    featured: true,
    badge: "updated",
  },
  {
    to: "/preview/profile",
    labelKey: "profile.title",
    fallback: "Profile",
    descriptionKey: "preview.profileDesc",
    descriptionFallback: "Account hub with pink hero",
    featured: true,
    badge: "updated",
  },
];

export const PREVIEW_SCREEN_GROUPS: {
  titleKey: string;
  titleFallback: string;
  screens: PreviewScreen[];
}[] = [
  {
    titleKey: "preview.groupLaunch",
    titleFallback: "Launch & sign-up",
    screens: [
      { to: "/preview/splash", labelKey: "preview.splash", fallback: "Splash animation" },
      { to: "/preview/onboarding", labelKey: "preview.onboarding", fallback: "Onboarding" },
      {
        to: "/preview/login",
        labelKey: "preview.registration",
        fallback: "Registration (sign in / sign up)",
      },
      { to: "/preview/otp", labelKey: "preview.otp", fallback: "OTP verification" },
      { to: "/preview/setup", labelKey: "preview.setup", fallback: "Profile setup" },
      { to: "/preview/forgot", labelKey: "auth.forgotTitle", fallback: "Forgot password" },
    ],
  },
  {
    titleKey: "preview.groupDiscover",
    titleFallback: "Discover & book",
    screens: [
      { to: "/preview/home", labelKey: "nav.home", fallback: "Home" },
      { to: "/preview/search", labelKey: "search.title", fallback: "Search" },
      {
        to: "/preview/category/home-cleaning",
        labelKey: "categories.homeTitle",
        fallback: "Home cleaning category",
      },
      {
        to: "/preview/provider/p1",
        labelKey: "preview.provider",
        fallback: "Provider profile",
        badge: "updated",
      },
      {
        to: "/preview/book/p1",
        labelKey: "preview.booking",
        fallback: "Book a pro",
        descriptionKey: "preview.bookingDesc",
        descriptionFallback: "Merged schedule — date & time dropdowns",
        badge: "updated",
      },
    ],
  },
  {
    titleKey: "preview.groupTabs",
    titleFallback: "Main tabs",
    screens: [
      {
        to: "/preview/bookings",
        labelKey: "bookings.title",
        fallback: "Bookings",
        badge: "updated",
      },
      { to: "/preview/messages", labelKey: "messages.title", fallback: "Messages" },
      { to: "/preview/chat/conv-1", labelKey: "preview.chat", fallback: "Chat thread" },
      {
        to: "/preview/profile",
        labelKey: "profile.title",
        fallback: "Profile",
        badge: "updated",
      },
    ],
  },
  {
    titleKey: "preview.groupAccount",
    titleFallback: "Account & settings",
    screens: [
      { to: "/preview/favorites", labelKey: "profile.favorites", fallback: "Favorites" },
      {
        to: "/preview/addresses",
        labelKey: "addresses.title",
        fallback: "Addresses",
        badge: "updated",
      },
      {
        to: "/preview/addresses/new",
        labelKey: "preview.addressNew",
        fallback: "Add address",
        badge: "updated",
      },
      {
        to: "/preview/addresses/addr-1",
        labelKey: "preview.addressEdit",
        fallback: "Edit address",
        badge: "updated",
      },
      { to: "/preview/family-members", labelKey: "familyMembers.title", fallback: "Family members" },
      { to: "/preview/notifications", labelKey: "common.notifications", fallback: "Notifications" },
      {
        to: "/preview/notification-preferences",
        labelKey: "notificationPreferences.title",
        fallback: "Notification preferences",
      },
      { to: "/preview/help", labelKey: "helpC.title", fallback: "Help" },
      { to: "/preview/promo-codes", labelKey: "promoCodes.title", fallback: "Promo codes" },
    ],
  },
];

/** Routes that use full-bleed layouts (no preview banner). */
export const PREVIEW_FULL_BLEED_PREFIXES = [
  "/preview/splash",
  "/preview/login",
  "/preview/onboarding",
  "/preview/otp",
  "/preview/setup",
  "/preview/forgot",
];
