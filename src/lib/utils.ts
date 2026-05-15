import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Returns current date/time as ISO string with CDMX offset (-06:00).
 * Mexico City no longer observes daylight saving time — fixed UTC-6.
 */
export function nowCDMX(): string {
  const now = new Date();
  const cdmx = new Date(now.getTime() - 6 * 60 * 60 * 1000 + now.getTimezoneOffset() * 60 * 1000);
  const iso = cdmx.getFullYear()
    + '-' + String(cdmx.getMonth() + 1).padStart(2, '0')
    + '-' + String(cdmx.getDate()).padStart(2, '0')
    + 'T' + String(cdmx.getHours()).padStart(2, '0')
    + ':' + String(cdmx.getMinutes()).padStart(2, '0')
    + ':' + String(cdmx.getSeconds()).padStart(2, '0')
    + '-06:00';
  return iso;
}

/**
 * Returns today's date in CDMX as YYYY-MM-DD string.
 */
export function todayCDMX(): string {
  return nowCDMX().slice(0, 10);
}

/**
 * Given a JS Date, returns start/end ISO strings for that full day in CDMX timezone.
 */
export function toCDMXFilterRange(date: Date): { start: string; end: string } {
  const dateStr = format(date, 'yyyy-MM-dd');
  return {
    start: dateStr + 'T00:00:00-06:00',
    end: dateStr + 'T23:59:59-06:00',
  };
}

/**
 * Formats a Date object as ISO string with CDMX offset (-06:00).
 * Useful for check-in/check-out where we build a date from new Date().
 */
export function dateToCDMX(date: Date): string {
  const cdmx = new Date(date.getTime() - 6 * 60 * 60 * 1000 + date.getTimezoneOffset() * 60 * 1000);
  const iso = cdmx.getFullYear()
    + '-' + String(cdmx.getMonth() + 1).padStart(2, '0')
    + '-' + String(cdmx.getDate()).padStart(2, '0')
    + 'T' + String(cdmx.getHours()).padStart(2, '0')
    + ':' + String(cdmx.getMinutes()).padStart(2, '0')
    + ':' + String(cdmx.getSeconds()).padStart(2, '0')
    + '-06:00';
  return iso;
}
