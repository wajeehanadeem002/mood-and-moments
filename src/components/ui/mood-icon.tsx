import {
  CloudRain,
  Flame,
  Heart,
  MoonStar,
  Smile,
  Waves,
  type LucideIcon,
} from "lucide-react";

import type { MoodId } from "@/data/moments";

const moodIcons: Record<MoodId, LucideIcon> = {
  happy: Smile,
  calm: Waves,
  loved: Heart,
  sad: CloudRain,
  angry: Flame,
  tired: MoonStar,
};

type MoodIconProps = {
  mood: MoodId;
  className?: string;
};

export function MoodIcon({ mood, className = "" }: MoodIconProps) {
  const Icon = moodIcons[mood];

  return (
    <Icon
      aria-hidden="true"
      className={className}
      focusable="false"
      strokeWidth={1.55}
    />
  );
}
