export type Category = string;

export interface Provider {
  id: string;
  name: string;
  category: Category;
  role: "Professional" | "Angel";
  avatar: string;
  rating: number;
  reviews: number;
  yearsExp: number;
  jobs: number;
  hourlyRate: number;
  bio: string;
  languages: string[];
  areas: string[];
  badges: string[];
  trustScore: number;
  gender: "Female" | "Male";
  gallery: string[];
  featured?: boolean;
}

const av = (seed: string) => `https://i.pravatar.cc/300?u=${seed}`;
const gal = (seed: string, n = 4) =>
  Array.from({ length: n }, (_, i) => `https://picsum.photos/seed/${seed}${i}/600/400`);

export const providers: Provider[] = [
  {
    id: "p1", name: "Mariam Hassan", category: "home", role: "Professional",
    avatar: av("mariam"), rating: 4.9, reviews: 218, yearsExp: 6, jobs: 412,
    hourlyRate: 180, bio: "Detail-oriented housekeeper with 6 years caring for premium homes in Sheikh Zayed. Trained in deep cleaning and laundry care.",
    languages: ["Arabic", "English"], areas: ["Sheikh Zayed", "6th of October"],
    badges: ["ID Verified", "Background Check", "Famy Certified"], trustScore: 98, gender: "Female",
    gallery: gal("home1"), featured: true,
  },
  {
    id: "p2", name: "Nadia Ibrahim", category: "home", role: "Professional",
    avatar: av("nadia"), rating: 4.8, reviews: 164, yearsExp: 4, jobs: 287,
    hourlyRate: 160, bio: "Warm and efficient. Specialises in family homes and post-event cleanups.",
    languages: ["Arabic"], areas: ["6th of October"],
    badges: ["ID Verified", "Background Check"], trustScore: 95, gender: "Female",
    gallery: gal("home2"),
  },
  {
    id: "p3", name: "Amira Saleh", category: "home", role: "Professional",
    avatar: av("amira"), rating: 4.9, reviews: 302, yearsExp: 8, jobs: 540,
    hourlyRate: 200, bio: "Senior housekeeper trusted by 100+ families. Calm, careful, and consistent.",
    languages: ["Arabic", "English"], areas: ["Sheikh Zayed"],
    badges: ["ID Verified", "Background Check", "Famy Certified", "Top Rated"], trustScore: 99, gender: "Female",
    gallery: gal("home3"), featured: true,
  },
  {
    id: "p4", name: "Heba Mostafa", category: "home", role: "Professional",
    avatar: av("heba"), rating: 4.7, reviews: 96, yearsExp: 3, jobs: 142,
    hourlyRate: 150, bio: "Friendly and reliable. Loves bringing order to busy households.",
    languages: ["Arabic"], areas: ["Sheikh Zayed", "6th of October"],
    badges: ["ID Verified"], trustScore: 92, gender: "Female",
    gallery: gal("home4"),
  },
  {
    id: "k1", name: "Salma Ahmed", category: "kids", role: "Angel",
    avatar: av("salma"), rating: 5.0, reviews: 187, yearsExp: 5, jobs: 246,
    hourlyRate: 220, bio: "Certified babysitter and early-childhood educator. Patient with toddlers and great with newborns.",
    languages: ["Arabic", "English"], areas: ["Sheikh Zayed", "6th of October"],
    badges: ["ID Verified", "Background Check", "First Aid", "Famy Certified"], trustScore: 99, gender: "Female",
    gallery: gal("kids1"), featured: true,
  },
  {
    id: "k2", name: "Yasmin Adel", category: "kids", role: "Angel",
    avatar: av("yasmin"), rating: 4.9, reviews: 142, yearsExp: 4, jobs: 198,
    hourlyRate: 200, bio: "Cheerful caregiver who turns playtime into learning. Bilingual.",
    languages: ["Arabic", "English"], areas: ["Sheikh Zayed"],
    badges: ["ID Verified", "First Aid"], trustScore: 96, gender: "Female",
    gallery: gal("kids2"),
  },
  {
    id: "k3", name: "Layla Farouk", category: "kids", role: "Angel",
    avatar: av("layla"), rating: 4.8, reviews: 89, yearsExp: 3, jobs: 122,
    hourlyRate: 180, bio: "Gentle and attentive. Experienced with twins and multi-child households.",
    languages: ["Arabic"], areas: ["6th of October"],
    badges: ["ID Verified", "Background Check"], trustScore: 94, gender: "Female",
    gallery: gal("kids3"),
  },
];

export const featuredProviders = providers.filter((p) => p.featured);
export const getProvider = (id: string) => providers.find((p) => p.id === id);
export const providersByCategory = (c: Category) => providers.filter((p) => p.category === c);

export const categories = [
  {
    id: "home" as const,
    title: "Famy Home",
    subtitle: "Cleaning & Housekeeping",
    description: "Verified housekeepers for deep cleans, weekly visits, and special occasions.",
    color: "var(--sky)",
    tint: "oklch(0.96 0.04 235)",
    icon: "🏡",
    fromPrice: 150,
  },
  {
    id: "kids" as const,
    title: "Famy Kids",
    subtitle: "Babysitting",
    description: "Trained caregivers and certified Angels for the moments that matter most.",
    color: "var(--coral)",
    tint: "oklch(0.96 0.04 25)",
    icon: "🧸",
    fromPrice: 180,
  },
];

export const reviewsByProvider: Record<string, { id: string; name: string; rating: number; text: string; date: string }[]> = {
  p1: [
    { id: "r1", name: "Yara M.", rating: 5, text: "Mariam transformed our apartment. She's careful, kind, and incredibly thorough.", date: "2 weeks ago" },
    { id: "r2", name: "Omar S.", rating: 5, text: "Best housekeeper we've ever had. Punctual and professional.", date: "1 month ago" },
    { id: "r3", name: "Dina A.", rating: 4, text: "Lovely person and great with our place. Highly recommend.", date: "2 months ago" },
  ],
  k1: [
    { id: "r1", name: "Rana K.", rating: 5, text: "Salma is incredible with our toddler. We finally got a date night!", date: "1 week ago" },
    { id: "r2", name: "Mohamed F.", rating: 5, text: "Trust her completely. Our daughter loves her.", date: "3 weeks ago" },
  ],
};
export const defaultReviews = [
  { id: "r1", name: "Sara H.", rating: 5, text: "Wonderful experience start to finish.", date: "2 weeks ago" },
  { id: "r2", name: "Khaled M.", rating: 5, text: "Professional and trustworthy. Will book again.", date: "1 month ago" },
];

export const offers = [
  { id: "o1", title: "20% off your first booking", subtitle: "Welcome to Famy", code: "FAMY20", gradient: "from-navy to-[#2d4ba8]" },
  { id: "o2", title: "Weekend cleans, weekday peace", subtitle: "Book Sat-Sun, save 15%", code: "WEEKEND15", gradient: "from-coral to-[#ff9a8b]" },
];

export const mockBookings = [
  {
    id: "FM-2031",
    providerId: "p1",
    service: "Famy Home — Deep Clean",
    date: "Tomorrow",
    time: "10:00 AM",
    duration: "4h",
    status: "upcoming" as const,
    price: 720,
    address: "Villa 12, Allegria, Sheikh Zayed",
  },
  {
    id: "FM-1987",
    providerId: "k1",
    service: "Famy Kids — Babysitting",
    date: "Last Friday",
    time: "7:00 PM",
    duration: "4h",
    status: "completed" as const,
    price: 880,
    address: "Apt 304, Westown, Sheikh Zayed",
  },
  {
    id: "FM-1902",
    providerId: "p3",
    service: "Famy Home — Weekly",
    date: "Mar 02",
    time: "9:00 AM",
    duration: "2h",
    status: "cancelled" as const,
    price: 400,
    address: "Apt 102, Beverly Hills, 6th of October",
  },
];

// mockMessages / mockChat removed in Phase 2 — messaging is now backed by
// the conversations and messages tables. See src/lib/db/messaging.ts.


export const mockNotifications = [
  { id: "n1", title: "Mariam is on the way", body: "Your professional will arrive in 15 minutes.", time: "Just now", type: "booking", unread: true },
  { id: "n2", title: "20% off your next clean", body: "Use code FAMY20 at checkout.", time: "2h ago", type: "offer", unread: true },
  { id: "n3", title: "Booking confirmed", body: "FM-2031 with Mariam Hassan is confirmed.", time: "Yesterday", type: "booking", unread: false },
];
