import { MomentsExperience } from "@/components/home/moments-experience";
import { QuoteSection } from "@/components/home/quote-section";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";

export default function Home() {
  return (
    <div id="home" className="min-h-screen bg-background text-primary">
      <SiteHeader />
      <main>
        <MomentsExperience />
        <QuoteSection />
      </main>
      <SiteFooter />
    </div>
  );
}
