/** Storm intensity for the sign-in backdrop when motion is enabled. */
export const SIGN_IN_AMBIENT_STORM = 0.72;

type RainDrop = {
  left: string;
  delay: string;
  duration: string;
  opacity: number;
};

/** Static rain configuration generated once at module load. */
export const SIGN_IN_RAIN_DROPS: readonly RainDrop[] = Array.from(
  { length: 28 },
  (_, index) => ({
    left: `${(index * 37 + 11) % 101}%`,
    delay: `${-((index * 0.37) % 3.8)}s`,
    duration: `${1.05 + (index % 7) * 0.08}s`,
    opacity: 0.16 + (index % 5) * 0.07,
  }),
);
