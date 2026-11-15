import { useEffect, useState } from "react";

/** Wall clock for countdowns; refreshes on an interval so renders stay pure. */
export function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(interval);
  }, []);
  return now;
}
