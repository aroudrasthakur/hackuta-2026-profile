import { useEffect, useRef } from "react";
import { OdysseyButton } from "../../components/OdysseyButton";
import { OliveBranch } from "../../components/art/OliveBranch";
import { Ship } from "../../components/art/Ship";
import { LANDING_URL } from "../../constants/site";
import { useHackathonName } from "../../hooks/useHackathonName";

export function SuccessStep() {
  const hackathonName = useHackathonName();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div
      className="flex flex-col items-center gap-6 py-8 text-center"
      role="status"
      aria-live="polite"
    >
      <div className="w-24 text-(--ocean) opacity-70" aria-hidden="true">
        <OliveBranch />
      </div>

      <div className="space-y-4">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="font-(family-name:--font-display) text-4xl text-(--ink) outline-none"
        >
          Your Journey Begins!
        </h1>

        <div className="mx-auto max-w-md space-y-3">
          <p className="text-lg font-semibold text-(--ocean)">
            You've officially joined the crew.
          </p>
          <p className="text-base leading-relaxed text-(--ink)/80">
            Thanks for applying to {hackathonName}. Keep an eye on your inbox —
            we'll email you with acceptance decisions and next steps as the
            event gets closer.
          </p>
        </div>
      </div>

      <div className="my-4 w-40 text-(--ink) opacity-30" aria-hidden="true">
        <Ship tone="ink" rowing={true} />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <OdysseyButton href="/profile">View your application</OdysseyButton>
        <OdysseyButton href={LANDING_URL}>Back to home</OdysseyButton>
      </div>

      <p className="mt-6 text-sm text-(--mist)">
        Check your email for confirmation.
      </p>
    </div>
  );
}
