import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { ProjectForm } from "@/components/project-form";

export default function NewProjectPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-16 sm:px-8">
        <Link
          href="/"
          className="text-sm text-ink-soft transition-colors hover:text-ink"
        >
          ← Back
        </Link>
        <h1 className="mt-6 font-[family-name:var(--font-display)] text-4xl font-bold tracking-tight">
          Add a project
        </h1>
        <p className="mt-3 max-w-xl text-ink-soft">
          A project is an outcome stream — not every repo. Name the goal Jarvis
          should steer toward.
        </p>
        <div className="mt-10">
          <ProjectForm />
        </div>
      </main>
    </>
  );
}
