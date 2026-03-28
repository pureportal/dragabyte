import { ask } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { toErrorMessage } from "./utils";

const SKIPPED_VERSION_KEY = "updater.skippedVersion";

const logInfo = (message: string): void => {
  console.info(`[updater] ${message}`);
};

const logError = (error: unknown): void => {
  console.error(`[updater] ${toErrorMessage(error)}`);
};

const getSkippedVersion = (): string | null => {
  try {
    return window.localStorage.getItem(SKIPPED_VERSION_KEY);
  } catch {
    return null;
  }
};

const setSkippedVersion = (version: string): void => {
  try {
    window.localStorage.setItem(SKIPPED_VERSION_KEY, version);
  } catch {
    return;
  }
};

const clearSkippedVersion = (): void => {
  try {
    window.localStorage.removeItem(SKIPPED_VERSION_KEY);
  } catch {
    return;
  }
};

const askForUpdateChoice = async (
  version: string,
): Promise<"update" | "remind" | "skip"> => {
  const shouldUpdateNow = await ask(
    `Version ${version} is available. Do you want to update now?`,
    {
      title: "Update Available",
      kind: "info",
      okLabel: "Update Now",
      cancelLabel: "More options",
    },
  );
  if (shouldUpdateNow) return "update";

  const shouldSkipVersion = await ask(
    `Do you want to skip version ${version}?`,
    {
      title: "Update Options",
      kind: "warning",
      okLabel: "Skip version",
      cancelLabel: "Remind later",
    },
  );
  if (shouldSkipVersion) return "skip";
  return "remind";
};

export const promptUpdateIfAvailable = async (): Promise<void> => {
  try {
    const update = await check();
    if (!update) return;
    if (getSkippedVersion() === update.version) {
      logInfo(`Skipped version ${update.version}`);
      return;
    }

    const choice = await askForUpdateChoice(update.version);
    if (choice === "remind") {
      logInfo(`User chose remind later for ${update.version}`);
      return;
    }
    if (choice === "skip") {
      setSkippedVersion(update.version);
      logInfo(`User skipped version ${update.version}`);
      return;
    }

    clearSkippedVersion();
    logInfo(`Update ${update.currentVersion} -> ${update.version}`);
    await update.downloadAndInstall();
    await relaunch();
  } catch (error) {
    logError(error);
  }
};
