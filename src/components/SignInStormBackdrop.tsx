import { lazy, Suspense, useSyncExternalStore, type CSSProperties } from "react";
import { SIGN_IN_AMBIENT_STORM, SIGN_IN_RAIN_DROPS } from "../constants/signInWeather";

const SignInAtmosphere = lazy(() =>
  import("./SignInAtmosphere").then((module) => ({
    default: module.SignInAtmosphere,
  })),
);

function subscribeToMotionPreference(onStoreChange: () => void) {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", onStoreChange);
  return () => media.removeEventListener("change", onStoreChange);
}

function getMotionPreference() {
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type SignInStormBackdropProps = {
  active?: boolean;
};

export function SignInStormBackdrop({ active = true }: SignInStormBackdropProps) {
  const prefersMotion = useSyncExternalStore(
    subscribeToMotionPreference,
    getMotionPreference,
    () => false,
  );
  const motionEnabled = prefersMotion && active;
  const storm = prefersMotion ? SIGN_IN_AMBIENT_STORM : 0;

  return (
    <div
      className="sign-in-storm"
      data-motion={motionEnabled}
      data-active={active}
      style={{ "--storm": storm } as CSSProperties}
      aria-hidden="true"
    >
      <div className="sign-in-storm__sky" />

      {prefersMotion ? (
        <div className="sign-in-storm__effects">
          <div className="sign-in-storm__haze" />
          <Suspense fallback={null}>
            <SignInAtmosphere motionEnabled={motionEnabled} storm={storm} />
          </Suspense>
          <div className="sign-in-storm__lightning sign-in-storm__lightning--left">
            <svg viewBox="0 0 120 330" focusable="false">
              <path d="m75 4-43 118 38-9-34 90 33-13-25 132 69-173-39 13 34-77-37 9Z" />
            </svg>
          </div>
          <div className="sign-in-storm__lightning sign-in-storm__lightning--right">
            <svg viewBox="0 0 120 330" focusable="false">
              <path d="m75 4-43 118 38-9-34 90 33-13-25 132 69-173-39 13 34-77-37 9Z" />
            </svg>
          </div>
          <div className="sign-in-storm__wash" />
          <div className="sign-in-storm__rain">
            {SIGN_IN_RAIN_DROPS.map((drop, index) => (
              <i
                key={index}
                style={{
                  left: drop.left,
                  animationDelay: drop.delay,
                  animationDuration: drop.duration,
                  opacity: drop.opacity,
                }}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
