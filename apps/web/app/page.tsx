import { SiteHeader } from "@/components/site-header";
import {
  Hero,
  InFlightSection,
  NeedsYouSection,
  ProjectsSection,
  RecentSection,
} from "@/components/dashboard";
import { getDashboardData, seedIfEmpty } from "@/lib/db/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function HomePage() {
  await seedIfEmpty();
  const data = await getDashboardData();

  return (
    <>
      <SiteHeader />
      <main className="flex-1 pb-20">
        <Hero
          needsCount={data.counts.needsYou}
          inFlightCount={data.counts.inFlight}
          projectCount={data.counts.projects}
        />
        <NeedsYouSection
          projects={data.needsYou.projects}
          jobs={data.needsYou.jobs}
        />
        <InFlightSection jobs={data.inFlight} />
        <ProjectsSection projects={data.projects} />
        <RecentSection jobs={data.recent} />
      </main>
      <footer className="mx-auto w-full max-w-6xl px-5 pb-10 sm:px-8">
        <div className="hud-frame px-4 py-3 font-mono text-[11px] uppercase tracking-[0.2em] text-ink-soft">
          jarvis // phase 1 hub online // chat + voice unlocking next
        </div>
      </footer>
    </>
  );
}
