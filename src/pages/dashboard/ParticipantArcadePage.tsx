import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ParticipantPageHeader } from "../../components/participant/ParticipantPageHeader";
import { ARCADE_URL } from "../../constants/site";
import { createLaunchCodeRef, getArcadeLauncherStateRef } from "../../convex/arcadeApi";
import { getConvexClient } from "../../convex/client";
import { useNow } from "../../hooks/useNow";

function formatArcadeClock(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(timestamp);
}

function formatCountdown(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

const STATUS_COPY = {
  on: {
    title: "The gates are open",
    body: "Deposit HackUTA points into your arcade wallet and try your luck in the temple trials.",
  },
  scheduled: {
    title: "The gates open soon",
    body: "Scout the rules below, then return when the countdown ends.",
  },
  off: {
    title: "The gates are sealed",
    body: "The arcade is closed. You can still withdraw leftover arcade points if you played earlier.",
  },
} as const;

export default function ParticipantArcadePage() {
  const client = getConvexClient();
  const [bucket, setBucket] = useState(0);
  const state = useQuery(getArcadeLauncherStateRef, client ? { nowBucket: bucket } : "skip");
  const nextChangeAt = state && state.visible ? state.nextChangeAt : null;
  useEffect(() => {
    if (!nextChangeAt) return;
    const wait = Math.max(0, nextChangeAt - Date.now()) + 250;
    const id = window.setTimeout(() => setBucket((value) => value + 1), Math.min(wait, 2 ** 31 - 1));
    return () => window.clearTimeout(id);
  }, [nextChangeAt]);

  const createLaunch = useMutation(createLaunchCodeRef);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = state?.visible === true;
  const status = visible ? state.status : "off";
  const copy = STATUS_COPY[status];
  const now = useNow();

  async function enterArcade() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createLaunch({});
      if (result.status === "ok") {
        const target = `${ARCADE_URL.replace(/\/+$/, "")}/launch#code=${encodeURIComponent(result.code)}`;
        window.location.assign(target);
        return;
      }
      if (result.code === "ARCADE_CLOSED" || result.code === "LAUNCH_DISABLED") {
        window.open(ARCADE_URL, "_blank", "noopener,noreferrer");
        return;
      }
      setError("The arcade is not ready for your account yet. Try again in a moment.");
    } catch {
      window.open(ARCADE_URL, "_blank", "noopener,noreferrer");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="participant-arcade" aria-labelledby="participant-arcade-title">
      <ParticipantPageHeader
        id="participant-arcade-title"
        title="HackUTA Arcade"
        description="Wager the points you've earned on gamble.hackuta.com — slots, wheel, and poker."
      />

      <div className="participant-arcade__hero" role="presentation">
        <div className="participant-arcade__glow" aria-hidden="true" />
        <div className="participant-arcade__inner">
          <p className="participant-arcade__eyebrow">Points trials</p>
          <h2 className="participant-arcade__title">{copy.title}</h2>
          <p className="participant-arcade__copy">{copy.body}</p>

          {visible && state.opensAt && status === "scheduled" ? (
            <p className="participant-arcade__countdown" role="status">
              Opens {formatArcadeClock(state.opensAt)} · {formatCountdown(state.opensAt - now)} to go
            </p>
          ) : null}
          {visible && state.closesAt && status === "on" ? (
            <p className="participant-arcade__countdown" role="status">
              Closes {formatArcadeClock(state.closesAt)} · {formatCountdown(state.closesAt - now)} left
            </p>
          ) : null}

          <div className="participant-arcade__actions">
            <button
              type="button"
              className="participant-arcade__cta"
              disabled={busy || state === undefined}
              onClick={() => void enterArcade()}
            >
              {busy ? "Opening the gates…" : "Enter the Arcade"}
            </button>
            <a className="participant-arcade__link" href={ARCADE_URL} target="_blank" rel="noopener noreferrer">
              Open gamble.hackuta.com
            </a>
          </div>

          {error ? (
            <p className="participant-arcade__error" role="alert">
              {error}
            </p>
          ) : null}

          {!visible && state !== undefined ? (
            <p className="participant-arcade__note" role="status">
              Play unlocks once you are accepted, checked in, and organizers open the gates (Convex arcade overlay on this deployment).
            </p>
          ) : null}
        </div>
      </div>

      <ul className="participant-arcade__facts">
        <li>
          <strong>Real stakes.</strong> Move points between your profile balance and the arcade wallet on the arcade site.
        </li>
        <li>
          <strong>Organizer hours.</strong> Admins time-gate the arcade; trials in progress can finish when the window ends.
        </li>
        <li>
          <strong>Fair play.</strong> Outcomes are decided on the server, not in your browser.
        </li>
      </ul>
    </section>
  );
}
