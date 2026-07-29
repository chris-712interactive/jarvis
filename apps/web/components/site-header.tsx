import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="relative z-20">
      <div className="mx-auto flex w-full max-w-[1400px] items-start justify-between px-5 pt-5 sm:px-8 sm:pt-6">
        <Link href="/" className="group flex items-center gap-3">
          <span className="relative flex h-8 w-8 items-center justify-center">
            <span className="absolute inset-0 rounded-full border border-beam/40" />
            <span className="absolute inset-1.5 rounded-full border border-flight/50 animate-[orbit_12s_linear_infinite]" />
            <span className="h-1.5 w-1.5 rounded-full bg-flight shadow-[0_0_10px_var(--flight)]" />
          </span>
          <span className="flex flex-col leading-none">
            <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-ink-soft">
              command
            </span>
            <span className="mt-1 font-mono text-[10px] uppercase tracking-[0.28em] text-flight">
              online
              <span className="boot-blink">_</span>
            </span>
          </span>
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2">
          <Link
            href="/#needs-you"
            className="hidden px-3 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-ink-soft transition-colors hover:text-signal sm:inline"
          >
            Priority
          </Link>
          <Link
            href="/#in-flight"
            className="hidden px-3 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-ink-soft transition-colors hover:text-flight sm:inline"
          >
            Active
          </Link>
          <Link
            href="/#projects"
            className="hidden px-3 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-ink-soft transition-colors hover:text-beam md:inline"
          >
            Projects
          </Link>
          <Link href="/projects/new" className="btn-ghost !px-3 !py-2 !text-[11px] uppercase tracking-[0.16em]">
            + Lane
          </Link>
        </nav>
      </div>
    </header>
  );
}
