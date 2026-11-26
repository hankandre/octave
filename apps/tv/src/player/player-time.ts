// The scrubber's times (DESIGN.md §7.14 item 2): elapsed as `41:00` or `1:21:40`, remaining as `−1:21:40`.
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

const twoDigits = (value: number): string => String(value).padStart(2, "0");

export function playerTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / SECONDS_PER_HOUR);
  const minutes = Math.floor((whole % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const rest = twoDigits(whole % SECONDS_PER_MINUTE);
  return hours > 0 ? `${hours}:${twoDigits(minutes)}:${rest}` : `${minutes}:${rest}`;
}

/** U+2212, the minus sign of DESIGN.md's `−1:21:40`. */
export const remainingTime = (positionSeconds: number, durationSeconds: number): string =>
  `−${playerTime(durationSeconds - positionSeconds)}`;
