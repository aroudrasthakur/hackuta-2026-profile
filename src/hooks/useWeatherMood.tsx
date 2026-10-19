import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type WeatherMood = "calm" | "enraged";

const STORAGE_KEY = "hackuta-weather-mood";

type WeatherMoodContextValue = {
  mood: WeatherMood;
  isEnraged: boolean;
  setMood: (mood: WeatherMood) => void;
};

const WeatherMoodContext = createContext<WeatherMoodContextValue | null>(null);

function readStoredMood(): WeatherMood {
  if (typeof window === "undefined") return "enraged";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "calm" || stored === "enraged" ? stored : "enraged";
}

export function WeatherMoodProvider({ children }: { children: ReactNode }) {
  const [mood, setMoodState] = useState<WeatherMood>(readStoredMood);

  const setMood = useCallback((nextMood: WeatherMood) => {
    setMoodState(nextMood);
    window.localStorage.setItem(STORAGE_KEY, nextMood);
  }, []);

  const value = useMemo(
    () => ({
      mood,
      isEnraged: mood === "enraged",
      setMood,
    }),
    [mood, setMood],
  );

  return <WeatherMoodContext.Provider value={value}>{children}</WeatherMoodContext.Provider>;
}

export function useWeatherMood() {
  const context = useContext(WeatherMoodContext);
  if (!context) {
    throw new Error("useWeatherMood must be used within WeatherMoodProvider");
  }
  return context;
}
