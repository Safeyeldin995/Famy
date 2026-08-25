import {
  AlertTriangle,
  Ban,
  Bell,
  Briefcase,
  Calendar,
  Heart,
  Inbox,
  MapPin,
  Search,
  Sparkles,
  UserRound,
  UserX,
  Users,
  MessageCircle,
  type LucideIcon,
} from "lucide-react";

export type EmptyStateIconName =
  | "default"
  | "alert"
  | "search"
  | "calendar"
  | "users"
  | "heart"
  | "inbox"
  | "bell"
  | "map-pin"
  | "ban"
  | "briefcase"
  | "user"
  | "user-x"
  | "message";

export const EMPTY_STATE_ICONS: Record<EmptyStateIconName, LucideIcon> = {
  default: Sparkles,
  alert: AlertTriangle,
  search: Search,
  calendar: Calendar,
  users: Users,
  heart: Heart,
  inbox: Inbox,
  bell: Bell,
  "map-pin": MapPin,
  ban: Ban,
  briefcase: Briefcase,
  user: UserRound,
  "user-x": UserX,
  message: MessageCircle,
};
