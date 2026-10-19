import { useWeatherMood, type WeatherMood } from "../hooks/useWeatherMood";

const OPTIONS: Array<{ value: WeatherMood; label: string }> = [
  { value: "calm", label: "Calm" },
  { value: "enraged", label: "Enrage" },
];

export function WeatherMoodToggle() {
  const { mood, setMood } = useWeatherMood();

  return (
    <div className="weather-mood-toggle" role="group" aria-label="Weather mood">
      {OPTIONS.map((option) => {
        const selected = mood === option.value;
        return (
          <button
            key={option.value}
            type="button"
            className="weather-mood-toggle__option"
            data-selected={selected}
            aria-pressed={selected}
            onClick={() => setMood(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
