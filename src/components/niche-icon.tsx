// Ícone de cada nicho (o nome do ícone vem do catálogo no banco)
import {
  Brush, Calendar, Dumbbell, Eye, Flower2, Hand, Heart, PenTool, Scissors, Sparkles, Star, type LucideIcon,
} from "lucide-react";

export const NICHE_ICONS: Record<string, LucideIcon> = {
  scissors: Scissors,
  hand: Hand,
  eye: Eye,
  brush: Brush,
  sparkles: Sparkles,
  flower: Flower2,
  pen: PenTool,
  dumbbell: Dumbbell,
  calendar: Calendar,
  heart: Heart,
  star: Star,
};

export function NicheIcon({ name, className }: { name?: string | null; className?: string }) {
  const Icon = NICHE_ICONS[name ?? ""] ?? Sparkles;
  return <Icon className={className} aria-hidden />;
}
