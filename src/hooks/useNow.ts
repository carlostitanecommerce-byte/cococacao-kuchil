import { useEffect, useState } from 'react';

/**
 * Shared "now" tick. A single setInterval is created globally and all
 * subscribers receive the same timestamp. This avoids spawning N intervals
 * when many components (e.g. SessionTimer rows) need to re-render every second.
 */
const subscribers = new Set<(t: number) => void>();
let intervalId: number | null = null;
let currentNow = Date.now();

function ensureInterval() {
  if (intervalId !== null) return;
  intervalId = window.setInterval(() => {
    currentNow = Date.now();
    subscribers.forEach((cb) => cb(currentNow));
  }, 1000);
}

function teardownInterval() {
  if (subscribers.size === 0 && intervalId !== null) {
    window.clearInterval(intervalId);
    intervalId = null;
  }
}

export function useNow(enabled = true): number {
  const [now, setNow] = useState(() => currentNow);

  useEffect(() => {
    if (!enabled) return;
    subscribers.add(setNow);
    ensureInterval();
    // Sync immediately so newly-mounted components don't wait up to 1s
    setNow(Date.now());
    return () => {
      subscribers.delete(setNow);
      teardownInterval();
    };
  }, [enabled]);

  return now;
}
