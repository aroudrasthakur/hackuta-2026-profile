import type { ReactNode } from "react";
import { WeatherMoodProvider, useWeatherMood } from "../hooks/useWeatherMood";
import { SignInStormBackdrop } from "./SignInStormBackdrop";
import { WeatherMoodToggle } from "./WeatherMoodToggle";

type StormPageFrameProps = {
  children: ReactNode;
};

function StormPageFrameInner({ children }: StormPageFrameProps) {
  const { isEnraged } = useWeatherMood();

  return (
    <main className="sign-in-page relative min-h-screen overflow-hidden">
      <SignInStormBackdrop active={isEnraged} />
      <WeatherMoodToggle />
      <div className="relative z-10">{children}</div>
    </main>
  );
}

export function StormPageFrame({ children }: StormPageFrameProps) {
  return (
    <WeatherMoodProvider>
      <StormPageFrameInner>{children}</StormPageFrameInner>
    </WeatherMoodProvider>
  );
}
