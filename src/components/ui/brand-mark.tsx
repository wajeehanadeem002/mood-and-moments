import { Flower2 } from "lucide-react";

type BrandMarkProps = {
  className?: string;
};

export function BrandMark({ className = "" }: BrandMarkProps) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-champagne/35 bg-champagne/5 text-champagne ${className}`}
    >
      <Flower2 className="size-5" strokeWidth={1.4} />
    </span>
  );
}
