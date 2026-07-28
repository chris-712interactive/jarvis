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
      <main className="flex-1 pb-24">
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
      <footer className="mx-auto w-full max-w-6xl px-6 pb-10 text-xs text-ink-soft/60 sm:px-8">
        Phase 1 — Project Hub. Chat, jobs dispatch, and voice come next.
      </footer>
    </>
  );
}
