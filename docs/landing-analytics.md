# Landing analytics

Configuration verified on 13 September 2026.

## Swetrix project

- Instance: https://swetrix.pureportal.io (Community Edition).
- Project: [Dragabyte](https://swetrix.pureportal.io/projects/3AO7nkgbztMj).
- Project ID: `3AO7nkgbztMj`.
- Website: `https://dragabyte.app/`.
- Allowed origins: `dragabyte.app` only.
- Collection: enabled. Dashboard: private. Bot protection: basic.
- Brand keyword: `dragabyte`.
- Collector: `https://swetrix.pureportal.io/backend/v1/log`.

The public project ID is bundled with the landing page. No API key, secret,
build variable, CDN script, or server proxy is required by the website.
Administration uses the instance’s API with an `X-Api-Key` header; never put
that credential in the website or repository.

## Website integration

`apps/landing/src/consent.ts` runs on the home, imprint, and privacy pages.
Visitors receive equally styled Accept and Reject buttons, a privacy link,
and a Privacy settings button in every footer. An accepted choice exposes
Withdraw consent when settings are reopened. The dialog is non-modal so
the website, downloads, and privacy policy remain usable without choosing.

The browser stores `accepted` or `rejected` under
`dragabyte.analytics-consent` until the choice changes or storage is cleared.
Only a successfully saved acceptance enables analytics. Storage errors leave
tracking off and show a recovery message. Changes synchronize across tabs;
restored pages recheck consent. Withdrawal removes listeners and timers,
disconnects section observation, aborts pending requests, and invalidates
pending initialization.

`apps/landing/src/analytics.ts` uses the [Swetrix Events API](https://swetrix.com/docs/events-api)
directly. This keeps request lifetimes under consent control and limits
payloads to the fields below. It is loaded only after acceptance, and only
on the production hostname. Ordinary navigation lets already consented
download requests finish with `keepalive`.

| Data | Implementation |
| --- | --- |
| Traffic, sessions, journeys | One pageview per document activation; heartbeat every 28 seconds while visible. Swetrix derives visitor, device, browser, location, and session statistics. |
| Performance | Eight navigation timings: DNS, TLS, connection, response, render, DOM load, page load, and TTFB. |
| Campaigns | `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, and `utm_content`; values limited to 100 characters using letters, numbers, spaces, underscores, dots, tildes, and hyphens. |
| Downloads | `download_click`, with `platform`, `format`, and release `version`. All five original direct links are preserved. |
| Download section | `download_section`, once when the section becomes visible. |
| Other home sections | `section_view`, with the section ID, once per section. |
| Screenshots | `screenshot_view`, with `disk-usage` or `batch-rename`. |
| External links | `outbound_click`, with the destination hostname. |
| Contact links | `contact_click`, with `email` or `phone`; no address or number is sent. |
| Errors | JavaScript errors and unhandled promise rejections. Standard error type and, when available, same-origin filename, line and column; maximum ten per activation. Messages and stack traces are omitted. |

Page paths exclude queries and fragments. Referrers contain only the origin.
No raw query string, account ID, tracking cookie, or session replay is sent.
Requests omit credentials and use an origin-only HTTP referrer. No events are
queued for later acceptance. Analytics failures do not interrupt navigation.

## Dashboard configuration

- **Downloads** traffic view: `download_click` displayed as the Downloads metric.
- **Download conversion** funnel: `/` → `download_click`.
- **Download journey** funnel: `/` → `download_section` → `download_click`.

These were created and read back through the instance’s administration API.

## Instance limitations

| Feature | Status / concrete blocker |
| --- | --- |
| Goals | `/backend/goal/project/3AO7nkgbztMj` returns HTTP 401 with the supplied API key. This route requires a signed-in user session. The download event, metric, and funnels are configured; a separate goal still needs dashboard access. |
| Google Search Console | `/backend/v1/project/gsc/3AO7nkgbztMj/status` returns HTTP 401 with API-key authentication. The project has no connected GSC property. Completing SEO reporting requires a dashboard session and Google OAuth access to the website’s property. The brand keyword is configured. |
| Session replay | Both `/backend/log/session-replays` and `/backend/v1/log/session-replays` return HTTP 404. The frontend advertises replay, but the running backend does not expose its API. Replay is not integrated. |
| Replay retention | Updating `sessionReplayRetentionDays` to 30 does not persist or appear in the project response. No retention setting is claimed as configured. |
| Alerts and scheduled reports | The Community Edition backend has no alert controller; `/backend/alert` and `/backend/v1/alert` return HTTP 404. No notification destination was configured. |
| Analytics retention and hosting details | The accessible project API exposes no general analytics retention setting or deployment/provider details. Server/database access is needed to verify retention, hosting location, processors, transfers, and backup handling. The privacy policy does not invent these details; the operator must complete those disclosures from the actual infrastructure. |
| Experiments and feature flags | No experiment variants or gated website features are specified. Adding them would change the preserved website behavior. No flags or experiments were created. |
| Identified profiles, revenue, CAPTCHA | The landing page has no accounts, checkout, or submission forms. These integrations are not applicable. |
| Historical imports and annotations | No historical dataset or deployed analytics launch date was provided. None were fabricated. |

## Verification and deployment

Run:

```sh
npm run typecheck --workspace @dragabyte/landing
npm run lint --workspace @dragabyte/landing
npx playwright install chromium
npm test --workspace @dragabyte/landing
```

On Windows, `PLAYWRIGHT_CHANNEL=msedge` uses installed Edge instead of a
downloaded Chromium. Browser tests serve the production build through
Playwright request fixtures; they do not start a development server or send
analytics to the instance. The existing content checker also runs against
a temporary static HTTP test fixture. CI installs Chromium, builds the site,
and runs these tests before uploading the landing artifact.

A separate live check served the built site in a browser at the production
origin using local response fixtures, with real requests to Swetrix after
acceptance. Pageview, download/section events, and error collection returned
HTTP 201. The project reported `isDataExists` and `isErrorDataExists`, and its
statistics showed the verification visit. The visit and custom events use
`utm_source=integration-check-20260913`; the test error has filename
`/assets/verification.js`. These verification records remain in the project.

The existing landing workflow builds and smoke-tests
`apps/landing/Dockerfile`, then publishes
`ghcr.io/pureportal/dragabyte-landing:latest` on main. This change requires no
analytics deployment secrets. Docker execution could not be checked locally
because the daemon is unavailable.

Production has not been redeployed. Publish the reviewed changes through the
existing workflow and roll out the resulting image using the production
hosting controls, which are not provided in this workspace. After rollout,
check initial rejection, acceptance, and withdrawal on `https://dragabyte.app/`
and confirm fresh production events in the project. Complete the infrastructure
privacy disclosures and the blocked dashboard settings with the access noted
above.
