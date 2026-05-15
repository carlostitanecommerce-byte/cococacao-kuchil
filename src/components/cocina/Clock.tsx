import { useEffect, useState } from 'react';

/**
 * Isolated clock component so the per-second tick does not re-render the
 * entire CocinaPage tree (and especially the order cards).
 */
export function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);
  const timeStr = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  return (
    <div className="text-2xl font-mono font-bold text-foreground tabular-nums">
      {timeStr}
    </div>
  );
}
