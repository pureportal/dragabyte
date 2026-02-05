import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]): string => {
  return twMerge(clsx(inputs));
};

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export const formatBytes = (bytes: number | null | undefined): string => {
  const safeBytes =
    typeof bytes === "number" && Number.isFinite(bytes) ? bytes : 0;
  let value = safeBytes;
  let index = 0;
  while (value >= 1024 && index < BYTE_UNITS.length - 1) {
    value /= 1024;
    index += 1;
  }
  const precision = value >= 10 || index === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${BYTE_UNITS[index]}`;
};

export const formatDuration = (
  durationMs: number | null | undefined,
): string => {
  const safeMs =
    typeof durationMs === "number" && Number.isFinite(durationMs)
      ? durationMs
      : 0;
  const totalSeconds = Math.max(0, Math.floor(safeMs / 1000));
  if (totalSeconds <= 60) {
    return `${totalSeconds}s`;
  }
  const padTime = (value: number): string => value.toString().padStart(2, "0");
  const totalMinutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  if (totalMinutes < 60) {
    return `${totalMinutes}m ${padTime(remainingSeconds)}s`;
  }
  const totalHours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  if (totalHours < 24) {
    return `${totalHours}h ${padTime(remainingMinutes)}m ${padTime(remainingSeconds)}s`;
  }
  const totalDays = Math.floor(totalHours / 24);
  const remainingHours = totalHours % 24;
  return `${totalDays}d ${padTime(remainingHours)}h ${padTime(remainingMinutes)}m ${padTime(remainingSeconds)}s`;
};

export const truncateMiddle = (value: string, maxLength: number): string => {
  const safeMax = Math.floor(maxLength);
  if (safeMax <= 0) return "";
  if (value.length <= safeMax) return value;
  if (safeMax <= 4) return value.slice(0, safeMax);

  const keep = safeMax - 3;
  const startLen = Math.max(2, Math.floor(keep * 0.35));
  const endLen = Math.max(2, keep - startLen);
  return `${value.slice(0, startLen)}...${value.slice(value.length - endLen)}`;
};
