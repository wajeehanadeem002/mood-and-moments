import { Hero } from "@/components/home/hero";
import { MemoryTimeline } from "@/components/home/memory-timeline";
import { QuoteSection } from "@/components/home/quote-section";
import { RecentMoments } from "@/components/home/recent-moments";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";

export default function Home() {
  return (
    <div id="home" className="min-h-screen bg-background text-primary">
      <SiteHeader />
      <main>
        <Hero />
        <RecentMoments />
        <MemoryTimeline />
        <QuoteSection />
      </main>
      <SiteFooter />
    </div>
  );
}
