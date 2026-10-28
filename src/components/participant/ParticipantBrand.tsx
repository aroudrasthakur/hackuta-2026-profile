import { Logo } from "../art/Logo";
import { LogoMark } from "../art/LogoMark";
import { LANDING_URL } from "../../constants/site";

/** Sidebar brand: the full logo and wordmark on desktop; the mobile header swaps in the mark only (participant-dashboard.css). */
export function ParticipantBrand() {
  return (
    <a href={LANDING_URL} className="participant-brand" aria-label="HackUTA home">
      <Logo className="participant-brand__logo h-7 w-auto" variant="light" layout="header" decorative />
      <span className="participant-brand__wordmark" aria-hidden="true">
        HackUTA
      </span>
      <LogoMark className="participant-brand__static" />
    </a>
  );
}
