import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 pt-8 sm:px-8">
      <Link href="/" className="group flex items-baseline gap-3">
        <span className="font-[family-name:var(--font-display)] text-2xl font-extrabold tracking-tight text-ink transition-transform duration-300 group-hover:-translate-y-0.5 sm:text-3xl">
          Jarvis
        </span>
        <span className="hidden font-mono text-[11px] uppercase tracking-[0.22em] text-ink-soft/70 sm:inline">
          command center
        </span>
      </Link>
      <nav className="flex items-center gap-2 sm:gap-3">
        <Link
          href="/#needs-you"
          className="px-3 py-2 text-sm text-ink-soft transition-colors hover:text-ink"
        >
          Needs you
        </Link>
        <Link
          href="/projects/new"
          className="rounded-md bg-ink px-3.5 py-2 text-sm font-medium text-paper transition-colors hover:bg-ink-soft"
        >
          Add project
        </Link>
      </nav>
    </header>
  );
}
