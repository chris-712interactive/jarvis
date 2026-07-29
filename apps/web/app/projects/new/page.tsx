import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { ProjectForm } from "@/components/project-form";

export default function NewProjectPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-14 sm:px-8">
        <Link
          href="/"
          className="font-mono text-xs uppercase tracking-[0.2em] text-ink-soft transition-colors hover:text-beam"
        >
          ← return to command
        </Link>
        <p className="mt-8 font-mono text-[11px] uppercase tracking-[0.28em] text-beam">
          {"//"} new lane
        </p>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl font-extrabold tracking-tight sm:text-5xl">
          Open a project lane
        </h1>
        <p className="mt-3 max-w-xl text-ink-soft">
          Define an outcome to steer — not just a repo. Goals beat vibes.
        </p>
        <div className="mt-10 hud-frame max-w-xl px-5 py-6 sm:px-6">
          <ProjectForm />
        </div>
      </main>
    </>
  );
}
