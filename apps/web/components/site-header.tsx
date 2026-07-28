import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-5 pt-6 sm:px-8 sm:pt-8">
      <Link href="/" className="group flex items-center gap-3">
        <span className="relative flex h-9 w-9 items-center justify-center border border-beam/50 bg-[color-mix(in_oklab,var(--panel)_90%,transparent)] shadow-[0_0_18px_color-mix(in_oklab,var(--beam)_25%,transparent)] transition-transform duration-300 group-hover:rotate-45">
          <span className="h-2.5 w-2.5 bg-flight shadow-[0_0_10px_var(--flight)]" />
        </span>
        <span className="flex flex-col">
          <span className="brand-mark font-[family-name:var(--font-display)] text-2xl font-extrabold uppercase tracking-[0.08em] sm:text-3xl">
            Jarvis
          </span>
          <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-ink-soft">
            systems online
            <span className="boot-blink text-flight">_</span>
          </span>
        </span>
      </Link>
      <nav className="flex items-center gap-2 sm:gap-3">
        <Link
          href="/#needs-you"
          className="hidden px-3 py-2 font-mono text-xs uppercase tracking-[0.18em] text-ink-soft transition-colors hover:text-signal sm:inline"
        >
          Alerts
        </Link>
        <Link
          href="/#in-flight"
          className="hidden px-3 py-2 font-mono text-xs uppercase tracking-[0.18em] text-ink-soft transition-colors hover:text-flight sm:inline"
        >
          Lanes
        </Link>
        <Link href="/projects/new" className="btn-primary">
          + New lane
        </Link>
      </nav>
    </header>
  );
}
