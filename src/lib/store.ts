import { create } from "zustand";
import { persist } from "zustand/middleware";

interface Profile {
  name: string;
  phone: string;
  address: string;
  apartment: string;
  building: string;
  compound: string;
  notes: string;
  avatar?: string;
}

export type AuthIntent = {
  purpose: "signup" | "reset";
  role?: "customer" | "provider";
} | null;

interface AppState {
  onboarded: boolean;
  authed: boolean;
  profile: Profile;
  favorites: string[];
  authIntent: AuthIntent;
  setOnboarded: (v: boolean) => void;
  setAuthed: (v: boolean) => void;
  setProfile: (p: Partial<Profile>) => void;
  setAuthIntent: (i: AuthIntent) => void;
  toggleFavorite: (id: string) => void;
  reset: () => void;
}

const emptyProfile: Profile = {
  name: "",
  phone: "",
  address: "",
  apartment: "",
  building: "",
  compound: "",
  notes: "",
};

export const useApp = create<AppState>()(
  persist(
    (set) => ({
      onboarded: false,
      authed: false,
      profile: emptyProfile,
      favorites: [],
      authIntent: null,
      setOnboarded: (v) => set({ onboarded: v }),
      setAuthed: (v) => set({ authed: v }),
      setProfile: (p) => set((s) => ({ profile: { ...s.profile, ...p } })),
      setAuthIntent: (i) => set({ authIntent: i }),
      toggleFavorite: (id) =>
        set((s) => ({
          favorites: s.favorites.includes(id)
            ? s.favorites.filter((f) => f !== id)
            : [...s.favorites, id],
        })),
      reset: () => set({ onboarded: false, authed: false, profile: emptyProfile, favorites: [], authIntent: null }),
    }),
    { name: "famio-app" }
  )
);
