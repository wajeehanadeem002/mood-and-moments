export type MoodId =
  | "happy"
  | "calm"
  | "loved"
  | "sad"
  | "angry"
  | "tired";

export type MoodDefinition = {
  id: MoodId;
  label: string;
  description: string;
  accent: "rose" | "lavender" | "champagne";
};

export type Moment = {
  id: string;
  revision?: number;
  date: string;
  dateTime: string;
  time: string;
  mood: MoodId;
  title: string;
  excerpt: string;
  image?: {
    src: string;
    alt: string;
  };
};

export const moods: readonly MoodDefinition[] = [
  {
    id: "happy",
    label: "Happy",
    description: "Moments of joy, gratitude, and light.",
    accent: "champagne",
  },
  {
    id: "calm",
    label: "Calm",
    description: "Moments of ease, clarity, and quiet.",
    accent: "lavender",
  },
  {
    id: "loved",
    label: "Loved",
    description: "Moments of closeness, warmth, and belonging.",
    accent: "rose",
  },
  {
    id: "sad",
    label: "Sad",
    description: "Moments that asked you to feel and soften.",
    accent: "lavender",
  },
  {
    id: "angry",
    label: "Angry",
    description: "Moments of heat, truth, and needed boundaries.",
    accent: "rose",
  },
  {
    id: "tired",
    label: "Tired",
    description: "Moments that called for rest and gentleness.",
    accent: "champagne",
  },
];

export const recentMoments: readonly Moment[] = [
  {
    id: "slow-sunday-light",
    date: "Aug 28, 2026",
    dateTime: "2026-08-28T08:32:00+05:00",
    time: "8:32 AM",
    mood: "happy",
    title: "Slow Sunday light",
    excerpt:
      "Morning sun through the curtains, no plans, just a quiet beautiful start.",
    image: {
      src: "/images/moments/slow-sunday-light.png",
      alt: "A warm cup of coffee beside dried flowers in soft morning window light.",
    },
  },
  {
    id: "call-worth-remembering",
    date: "Aug 27, 2026",
    dateTime: "2026-08-27T19:14:00+05:00",
    time: "7:14 PM",
    mood: "loved",
    title: "A call worth remembering",
    excerpt:
      "Caught up with an old friend. We laughed for an hour and it felt like no time had passed.",
    image: {
      src: "/images/moments/call-worth-remembering.png",
      alt: "A vintage black telephone beside a notebook in warm evening light.",
    },
  },
  {
    id: "rain-against-window",
    date: "Aug 26, 2026",
    dateTime: "2026-08-26T18:08:00+05:00",
    time: "6:08 PM",
    mood: "calm",
    title: "Rain against the window",
    excerpt:
      "The steady rhythm helped me slow down and be present with my thoughts.",
    image: {
      src: "/images/moments/rain-against-window.png",
      alt: "Rain on a dark window with a candle and mug glowing nearby.",
    },
  },
];

export const timelineMoments: readonly Moment[] = [
  ...recentMoments,
  {
    id: "slower-morning",
    date: "Aug 24, 2026",
    dateTime: "2026-08-24T09:41:00+05:00",
    time: "9:41 AM",
    mood: "tired",
    title: "Needed a slower morning",
    excerpt:
      "Extra sleep, a long shower, and no rush. I gave myself permission to rest.",
  },
  {
    id: "walked-by-river",
    date: "Aug 22, 2026",
    dateTime: "2026-08-22T17:20:00+05:00",
    time: "5:20 PM",
    mood: "calm",
    title: "Walked by the river",
    excerpt: "Cool air, moving water, and space to think about what matters.",
  },
];
