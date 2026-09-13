const projectId = "3AO7nkgbztMj";
const endpoint = "https://swetrix.pureportal.io/backend/v1/log";

type Metadata = Record<string, string>;

function campaignTags(): Metadata {
  const query = new URLSearchParams(location.search);
  const tags: Metadata = {};
  for (const [parameter, field] of Object.entries({
    utm_source: "so",
    utm_medium: "me",
    utm_campaign: "ca",
    utm_term: "te",
    utm_content: "co",
  })) {
    const value = query.get(parameter);
    if (value && /^[\w .~-]{1,100}$/.test(value)) tags[field] = value;
  }
  return tags;
}

function performanceTimings() {
  const navigation = performance.getEntriesByType("navigation")[0];
  if (!(navigation instanceof PerformanceNavigationTiming)) return undefined;
  return {
    dns: navigation.domainLookupEnd - navigation.domainLookupStart,
    tls: navigation.secureConnectionStart
      ? navigation.connectEnd - navigation.secureConnectionStart
      : 0,
    conn: navigation.secureConnectionStart
      ? navigation.secureConnectionStart - navigation.connectStart
      : navigation.connectEnd - navigation.connectStart,
    response: navigation.responseEnd - navigation.responseStart,
    render: navigation.domComplete - navigation.domContentLoadedEventEnd,
    dom_load: navigation.domContentLoadedEventEnd - navigation.responseEnd,
    page_load: navigation.loadEventStart,
    ttfb: navigation.responseStart - navigation.requestStart,
  };
}

export function startAnalytics(hasConsent: () => boolean) {
  const listeners = new AbortController();
  const requests = new AbortController();
  const context = {
    pg: location.pathname,
    lc: navigator.language,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    ref: document.referrer ? new URL(document.referrer).origin : undefined,
    ...campaignTags(),
  };
  let active = true;
  let reportedFailure = false;

  function send(path: "" | "/custom" | "/hb" | "/error", payload: object) {
    if (!active || !hasConsent()) return;
    void fetch(`${endpoint}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      referrerPolicy: "origin",
      keepalive: true,
      signal: requests.signal,
      body: JSON.stringify({ ...payload, pid: projectId }),
    })
      .then((response) => {
        if (!response.ok) throw new Error("Analytics request failed");
      })
      .catch(() => {
        if (requests.signal.aborted || reportedFailure) return;
        reportedFailure = true;
        console.warn("Swetrix could not receive analytics.");
      });
  }

  function track(event: string, meta?: Metadata) {
    send("/custom", { ...context, ev: event, meta });
  }

  function trackLink(event: MouseEvent) {
    if (event.type === "auxclick" && event.button !== 1) return;
    const link = event.target instanceof Element
      ? event.target.closest<HTMLAnchorElement>("a[href]")
      : null;
    if (!link) return;
    const url = new URL(link.href);
    if (link.matches(".download-link")) {
      const format = url.pathname.split(".").at(-1)?.toLowerCase();
      const version = /\/download\/v([^/]+)\//.exec(url.pathname)?.[1];
      if (format && version) {
        track("download_click", {
          platform: ["exe", "msi"].includes(format) ? "windows" : "linux",
          format,
          version,
        });
      }
    } else if (link.hasAttribute("data-screenshot")) {
      track("screenshot_view", {
        image: url.pathname.includes("rename") ? "batch-rename" : "disk-usage",
      });
    } else if (["mailto:", "tel:"].includes(url.protocol)) {
      track("contact_click", { method: url.protocol === "mailto:" ? "email" : "phone" });
    } else if (url.protocol === "https:" && url.origin !== location.origin) {
      track("outbound_click", { destination: url.hostname });
    }
  }

  let errorCount = 0;
  function reportError(error: unknown, filename?: string, lineno?: number, colno?: number) {
    if (errorCount >= 10) return;
    const name = error instanceof Error && [
      "Error", "TypeError", "ReferenceError", "SyntaxError", "RangeError", "URIError", "EvalError",
    ].includes(error.name) ? error.name : "Error";
    const source = filename ? new URL(filename, location.href) : null;
    if (source && source.origin !== location.origin) return;
    errorCount += 1;
    send("/error", {
      pg: context.pg,
      lc: context.lc,
      tz: context.tz,
      name,
      filename: source ? `${source.origin}${source.pathname}` : undefined,
      lineno,
      colno,
    });
  }

  const options = { signal: listeners.signal };
  document.addEventListener("click", trackLink, options);
  document.addEventListener("auxclick", trackLink, options);
  window.addEventListener("error", (event) => {
    reportError(event.error, event.filename, event.lineno, event.colno);
  }, options);
  window.addEventListener("unhandledrejection", (event) => {
    reportError(event.reason);
  }, options);

  const sections = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const section = entry.target.id;
      track(section === "download" ? "download_section" : "section_view", { section });
      sections.unobserve(entry.target);
    }
  }, { threshold: 0.15 });
  document.querySelectorAll("main > section[id]").forEach((section) => sections.observe(section));

  send("", { ...context, perf: performanceTimings() });
  const heartbeat = window.setInterval(() => {
    if (document.visibilityState === "visible") send("/hb", {});
  }, 28_000);

  return (discardPending = true) => {
    active = false;
    clearInterval(heartbeat);
    sections.disconnect();
    listeners.abort();
    if (discardPending) requests.abort();
  };
}
