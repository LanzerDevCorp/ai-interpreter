---
name: playwright-e2e-author
description: "Trigger: E2E test, end-to-end, Playwright, critical path, extend flow, deterministic browser test. Explore a flow, then author or extend it via the Playwright MCP into a tagged, helper-composed deterministic spec mapped in FLOWS.md."
license: Apache-2.0
metadata:
  author: LanzerDevCorp
  version: "2.0"
---

# Playwright E2E Author & Extend (MCP → deterministic spec)

## Activation Contract

Load when authoring a NEW end-to-end flow or EXTENDING an existing one with
branches / edge cases. The flow costs tokens ONCE (MCP authoring) and re-runs
free and deterministically (committed spec). Triggers: "test E2E", "validar
flujo X", "extender el flujo", "agregar edge case / rama", "critical path".

## Hard Rules

- EXPLORE before the MCP. Never author or extend a flow you have not mapped.
- The MCP is the AUTHOR; the committed `.spec.ts` is the ARTIFACT. Never re-drive
  a crystallized path.
- Compose action helpers from `tests/e2e/actions/*` — one function per
  affordance. Never duplicate selectors across specs; add or reuse a helper.
- Tag every test for selective runs: `@<flow>` (master) plus branch/edge tags.
- Keep `tests/e2e/FLOWS.md` current: read it before extending, flip ✅/⬜ after.
- Accessibility tree only (`getByRole` / `getByLabel`). Anchor ambiguous matches
  by role (e.g. `getByRole("textbox", …)`) to dodge `aria-labelledby` collisions.
- Persist auth via storageState (gitignored). RBAC role via `app_metadata.role`.
- Embed a per-run unique marker in created data. Verify GREEN headless before done.

## Decision Gates

| Situation | Action |
|-----------|--------|
| New flow | New spec + new section in FLOWS.md; author helpers via the MCP |
| Extend a flow (branch / edge) | Reuse helpers; add a tagged test; update FLOWS.md |
| Same outcome via different UI affordance | Parameterize over a strategy array |
| Flow needs staff session | Context with `storageState`; else default context |
| Watch it run | `SLOWMO=800 … --headed`, step `--debug`, time-travel `--ui` |

## Execution Steps

1. EXPLORE with `/sdd-explore` or the Explore agent: map routes, components,
   server actions, auth/RLS, the success signal, edge cases, and the decision
   tree of affordances that reach each state.
2. For EXTEND: read FLOWS.md + the target spec + existing helpers; find the gap.
3. AUTHOR/confirm selectors with the Playwright MCP (headed): navigate → snapshot
   → act via roles. Record exact selectors.
4. CRYSTALLIZE: add or reuse helpers in `tests/e2e/actions/`; write or extend the
   spec with tags; parameterize convergent branches over a strategy array.
5. WIRE if new: load env, add a `setup` project + storageState; `npx playwright
   install chromium` if browsers are missing.
6. VERIFY: `npx playwright test {flow} --project=chromium` is green AND
   `--grep @tag` selects correctly; then update FLOWS.md ✅/⬜.

## Output Contract

Return: files created/modified, the exact run + selective-run (`--grep`) + watch
commands, the FLOWS.md coverage delta, and confirmation the spec passes headless.

## References

- `assets/global.setup.ts.template` — admin seeder + storageState
- `assets/ticket-actions.ts.template` — action-helper shape (one fn per affordance)
- `assets/lifecycle.spec.ts.template` — tagged, parameterized, two-context flow
- `assets/FLOWS.md.template` — coverage map structure
- `references/edge-cases.md` — selectors, tags, and gotchas
