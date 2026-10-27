import { LOGO_MARK_PATHS, LOGO_MARK_VIEWBOX } from "../../constants/logoMark";

/** Static, decorative mark; the surrounding link supplies the accessible name. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox={LOGO_MARK_VIEWBOX} aria-hidden="true" focusable="false">
      {LOGO_MARK_PATHS.map((d) => (
        <path key={d} d={d} fill="currentColor" />
      ))}
    </svg>
  );
}
