import {
  logoDefaultSrc,
  logoSrcSet,
  LOGO_SIZES,
  type LogoLayout,
  type LogoVariant,
} from "../../constants/images";

type LogoProps = {
  className?: string;
  variant?: LogoVariant;
  layout?: LogoLayout;
  priority?: boolean;
  /** Use when adjacent text or a parent link already names HackUTA. */
  decorative?: boolean;
};

export function Logo({
  className = "",
  variant = "light",
  layout = "header",
  priority = false,
  decorative = false,
}: LogoProps) {
  return (
    <img
      src={logoDefaultSrc(variant)}
      srcSet={logoSrcSet(variant)}
      sizes={LOGO_SIZES[layout]}
      alt={decorative ? "" : "HackUTA"}
      aria-hidden={decorative ? true : undefined}
      className={className}
      width={52}
      height={52}
      decoding="async"
      fetchPriority={priority && !decorative ? "high" : undefined}
      loading={priority ? "eager" : "lazy"}
    />
  );
}
