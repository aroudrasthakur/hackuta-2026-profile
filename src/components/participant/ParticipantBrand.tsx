import { Logo } from "../art/Logo";
import { LogoMark } from "../art/LogoMark";
import { LANDING_URL } from "../../constants/site";

/** Sidebar brand: the full logo on desktop; the mobile header swaps in the mark only (participant-dashboard.css). */
export function ParticipantBrand() {
  return (
    <a href={LANDING_URL} className="participant-brand" aria-label="HackUTA home">
      <Logo className="participant-brand__logo h-7 w-auto" variant="light" layout="header" decorative />
      <LogoMark className="participant-brand__static" />
    </a>
  );
}
