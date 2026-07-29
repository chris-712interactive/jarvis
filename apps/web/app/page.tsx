import { SiteHeader } from "@/components/site-header";
import { ChatPanel } from "@/components/chat-panel";
import { JobPoller } from "@/components/job-poller";
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

  const topProject = data.needsYou.projects[0];
  const topJob = data.needsYou.jobs[0];
  const topAlert = topProject
    ? {
        title: topProject.name,
        detail: topProject.needsYou ?? "Requires a decision.",
        href: `/projects/${topProject.id}`,
      }
    : topJob
      ? {
          title: topJob.title,
          detail: topJob.summary || "Needs a decision.",
          href: topJob.project ? `/projects/${topJob.project.id}` : undefined,
        }
      : undefined;

  return (
    <>
      <SiteHeader />
      <JobPoller hasInFlight={data.counts.inFlight > 0} />
      <main className="flex-1 pb-16">
        <Hero
          needsCount={data.counts.needsYou}
          inFlightCount={data.counts.inFlight}
          projectCount={data.counts.projects}
          topAlert={topAlert}
        />
        <NeedsYouSection
          projects={data.needsYou.projects}
          jobs={data.needsYou.jobs}
        />
        <InFlightSection jobs={data.inFlight} />
        <ProjectsSection projects={data.projects} />
        <RecentSection jobs={data.recent} />
      </main>
      <footer className="mx-auto w-full max-w-[1400px] px-5 pb-8 sm:px-8">
        <div className="flex items-center justify-between gap-4 border-t border-beam/15 pt-4 font-mono text-[10px] uppercase tracking-[0.22em] text-ink-soft">
          <span>hub // phase 3 async jobs online</span>
          <span>coding agents next</span>
        </div>
      </footer>
      <ChatPanel projects={data.projects} />
    </>
  );
}
