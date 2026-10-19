import type { ReactNode } from "react";
import { Logo } from "./art/Logo";
import { Ship } from "./art/Ship";
import { LANDING_URL } from "../constants/site";

type PageShellProps = {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  showHeader?: boolean;
  frameless?: boolean;
  wide?: boolean;
  compact?: boolean;
  footer?: ReactNode;
};

export function PageShell({
  children,
  title,
  subtitle,
  showHeader = true,
  frameless = false,
  wide = false,
  compact = false,
  footer,
}: PageShellProps) {
  const content = (
    <div
      className={`relative z-10 mx-auto flex min-h-screen w-full flex-col items-center ${
        wide ? "max-w-[min(96rem,100%)] px-4 sm:px-6 lg:px-10" : "max-w-3xl px-6"
      } ${compact ? "py-4 sm:py-6" : "py-12 sm:py-16"}`}
    >
      {showHeader ? (
        <div
          className={`flex flex-col items-center gap-4 ${compact ? "mb-5" : "mb-10"}`}
        >
          <a
            href={LANDING_URL}
            aria-label="HackUTA home"
            className="inline-flex transition-opacity hover:opacity-80"
          >
            <Logo
              className="h-14 w-auto sm:h-16"
              variant="light"
              layout="header"
              decorative
            />
          </a>
          {title ? (
            <div className="text-center">
              <h1 className="font-(family-name:--font-display) text-2xl text-(--ink) sm:text-3xl">
                {title}
              </h1>
              {subtitle ? (
                <p className="mt-2 text-sm text-(--ocean)">{subtitle}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="relative w-full">
        <div
          className="absolute -left-2 -top-2 z-20 h-8 w-8 border-l-2 border-t-2 border-(--ink)/20"
          aria-hidden="true"
        />
        <div
          className="absolute -right-2 -top-2 z-20 h-8 w-8 border-r-2 border-t-2 border-(--ink)/20"
          aria-hidden="true"
        />
        <div
          className="absolute -bottom-2 -left-2 z-20 h-8 w-8 border-b-2 border-l-2 border-(--ink)/20"
          aria-hidden="true"
        />
        <div
          className="absolute -bottom-2 -right-2 z-20 h-8 w-8 border-b-2 border-r-2 border-(--ink)/20"
          aria-hidden="true"
        />

        <div
          className={`relative z-10 overflow-visible rounded-2xl border-2 border-(--sand) bg-(--light) shadow-[0_10px_40px_rgba(26,58,82,0.12)] ${
            compact
              ? "flex min-h-[min(78vh,50rem)] flex-col p-6 sm:p-10 lg:p-12"
              : "p-8 sm:p-12"
          }`}
        >
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(26,58,82,0.02),transparent_60%)]"
            aria-hidden="true"
          />
          <div
            className={`relative z-10 ${compact ? "flex min-h-0 flex-1 flex-col" : ""}`}
          >
            {children}
          </div>
        </div>
      </div>

      {footer}
    </div>
  );

  if (frameless) {
    return content;
  }

  return (
    <main className="register-page relative min-h-screen overflow-hidden bg-(--clay)">
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        aria-hidden="true"
      >
        <div className="absolute left-0 right-0 top-0 h-2 bg-[repeating-linear-gradient(90deg,var(--ink)_0,var(--ink)_12px,transparent_12px,transparent_24px,var(--ink)_24px,var(--ink)_36px,transparent_36px,transparent_40px)] opacity-20" />
        <svg
          className="absolute bottom-0 left-0 w-full opacity-5"
          viewBox="0 0 1200 120"
          preserveAspectRatio="none"
        >
          <path
            d="M0,60 Q300,20 600,60 T1200,60 L1200,120 L0,120 Z"
            fill="var(--ink)"
          />
        </svg>
        <div className="absolute bottom-8 right-8 w-32 opacity-10 md:w-40">
          <Ship tone="ink" rowing={false} />
        </div>
      </div>

      {content}
    </main>
  );
}
