import "./consent.css";

type Choice = "accepted" | "rejected";
const storageKey = "dragabyte.analytics-consent";
const privacyUrl = new URL("privacy/", document.querySelector<HTMLAnchorElement>(".brand")!.href).href;
let choice: Choice | null = readChoice();
let generation = 0;
let stopAnalytics: ((discardPending?: boolean) => void) | undefined;
let returnFocus: HTMLElement | null = null;

function readChoice(): Choice | null {
  try {
    const value = localStorage.getItem(storageKey);
    return value === "accepted" || value === "rejected" ? value : null;
  } catch {
    return null;
  }
}

const settings = document.createElement("button");
settings.type = "button";
settings.className = "consent-settings";
settings.textContent = "Privacy settings";
document.querySelector(".site-footer nav")?.append(settings);

const dialog = document.createElement("dialog");
dialog.className = "consent-dialog";
dialog.setAttribute("aria-labelledby", "consent-title");
dialog.setAttribute("aria-describedby", "consent-description");
dialog.innerHTML = `
  <h2 id="consent-title">Analytics</h2>
  <button class="consent-close" type="button" aria-label="Close privacy settings" hidden>
    <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" /></svg>
  </button>
  <p id="consent-description">Allow Swetrix to measure visits, downloads, performance and errors?</p>
  <a class="consent-policy" href="${privacyUrl}">Privacy policy</a>
  <p class="consent-error" role="alert" hidden></p>
  <div class="consent-actions">
    <button type="button" data-choice="rejected">Reject</button>
    <button type="button" data-choice="accepted">Accept</button>
  </div>
`;
document.body.append(dialog);
const reject = dialog.querySelector<HTMLButtonElement>('[data-choice="rejected"]')!;
const close = dialog.querySelector<HTMLButtonElement>(".consent-close")!;
const error = dialog.querySelector<HTMLParagraphElement>(".consent-error")!;

function openSettings(trigger: Element | null = document.activeElement) {
  reject.textContent = choice === "accepted" ? "Withdraw consent" : "Reject";
  close.hidden = choice === null;
  if (trigger instanceof HTMLElement && !dialog.contains(trigger)) {
    returnFocus = trigger;
  }
  if (!dialog.open) dialog.show();
  reject.focus({ preventScroll: true });
}

function closeSettings() {
  error.hidden = true;
  dialog.close();
  returnFocus?.focus({ preventScroll: true });
}

async function updateTracking() {
  const current = ++generation;
  stopAnalytics?.();
  stopAnalytics = undefined;
  if (choice !== "accepted" || location.hostname !== "dragabyte.app") return;
  try {
    const { startAnalytics } = await import("./analytics");
    if (document.readyState !== "complete") {
      await new Promise<void>((resolve) => window.addEventListener("load", () => resolve(), { once: true }));
    }
    if (current !== generation || readChoice() !== "accepted") return;
    stopAnalytics = startAnalytics(() => readChoice() === "accepted");
  } catch {
    console.warn("Swetrix analytics could not start.");
  }
}

function saveChoice(next: Choice) {
  choice = next;
  generation += 1;
  stopAnalytics?.();
  stopAnalytics = undefined;
  try {
    localStorage.setItem(storageKey, next);
  } catch {
    choice = null;
    close.hidden = true;
    error.textContent = "Your choice could not be saved. Allow browser storage and try again.";
    error.hidden = false;
    return;
  }
  closeSettings();
  void updateTracking();
}

dialog.querySelectorAll<HTMLButtonElement>("[data-choice]").forEach((button) => {
  button.addEventListener("click", () => saveChoice(button.dataset.choice as Choice));
});
settings.addEventListener("click", () => openSettings(settings));
close.addEventListener("click", closeSettings);
dialog.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || choice === null) return;
  event.preventDefault();
  closeSettings();
});
document.querySelectorAll("[data-consent-settings]").forEach((button) => {
  button.removeAttribute("hidden");
  button.addEventListener("click", () => openSettings(button));
});
window.addEventListener("storage", (event) => {
  if (event.key !== storageKey && event.key !== null) return;
  choice = readChoice();
  void updateTracking();
  if (choice === null) openSettings();
  else {
    error.hidden = true;
    dialog.close();
  }
});
window.addEventListener("pagehide", () => {
  generation += 1;
  stopAnalytics?.(false);
  stopAnalytics = undefined;
});
window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  choice = readChoice();
  void updateTracking();
  if (choice === null) openSettings();
});

if (choice === null) openSettings();
void updateTracking();
