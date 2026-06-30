# Repo-specific E2E gotchas (corp-tickets)

Read before authoring. These are the traps that silently break deterministic runs.

## Auth & RBAC

- The app RBAC role is the JWT `app_role` claim, injected by a custom access
  token hook from the auth user's `app_metadata.role` (migrations
  `20260619170000` / `20260619180000`). When seeding a staff user via the admin
  API, set `app_metadata: { role: "admin" }` — setting `public.users.role` alone
  does NOT grant the claim.
- Login form selectors: `[name="email"]`, `[name="password"]`, `[type="submit"]`.
  Successful staff login redirects to `/dashboard`.
- `tests/e2e/.auth/admin.json` (storageState) holds a live session token. It is
  gitignored; never commit it. `global.setup.ts` regenerates it each run.

## Environment

- Supabase env vars live in `.env.local`, NOT `.env`. The Playwright runner does
  not auto-load env (unlike Next), so `playwright.config.ts` calls
  `process.loadEnvFile` for both `.env` and `.env.local` (Node 20.12+/25).
- Existing public-form happy-path tests self-skip when env is unloaded — that is
  the symptom of a missing env load, not a passing test.

## Browser & form quirks

- The Playwright MCP uses its own browser; the test runner needs
  `npx playwright install chromium` separately (one-time).
- Category is a Radix custom combobox (not a native `<select>`): click the
  combobox, then `getByRole("option", { name })`. Priority is a radio group.
- The public ticket form's submit button stays disabled until all fields are
  valid; fill every field before clicking.
- Dashboard ticket subject renders the full string in the DOM (CSS `truncate`,
  not JS), so `getByText(subject)` matches even when visually clipped.

## Selectors & sync (learned the hard way)

- `getByLabel(/X/i)` also matches a container whose `aria-labelledby` resolves to
  a string containing X (e.g. a dialog titled "Indica el motivo de cierre" vs a
  textarea labeled "Motivo de cierre"). Anchor by role: `getByRole("textbox",
  { name: /motivo de cierre/i })`.
- The tooltip hover-card resolve button is labeled "Resuelto" (Spanish), not
  "Mark as resolved" — UI labels drift, so verify against the live component.
- The tooltip resolve action does not return a UI signal you can rely on across
  Realtime/refetch timing; sync on the server action response instead:
  `page.waitForResponse(r => r.request().method() === "POST" && r.request().headers()["next-action"] !== undefined)`.
- Resolved/closed tickets leave the default open/in_progress queue, so assert the
  outcome on the detail page (`getByLabel(/estado del ticket/i)`), not the queue.
- Detail status `<Select>`: open via `getByLabel(/estado del ticket/i)`, pick
  `getByRole("option", { name: /^Resuelto$/i })`. "Cerrado" opens a closure
  dialog; empty reason shows "Indica un motivo para cerrar el ticket".

## Tags & selective runs

- Tag tests with `test(title, { tag: ["@flow", "@branch"] }, fn)`.
- Run a group: `--grep @resolve`; one branch: `--grep @tooltip`; exclude:
  `--grep-invert @negative`. The "master" run is just the flow tag (`@lifecycle`).

## Watch / pace commands

- Slow live run: `SLOWMO=800 npx playwright test {flow} --project=chromium --headed`
- Manual stepping: `PWDEBUG=1 npx playwright test {flow} --project=chromium`
- Time-travel UI: `npx playwright test {flow} --project=chromium --ui`
- Restrict to one browser to avoid creating duplicate rows: `--project=chromium`.
