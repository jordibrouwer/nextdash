## Summary

<!-- What changed and why -->

## Dashboard refactor (if applicable)

- [ ] No intentional behavior change
- [ ] Script tag added via `{{asset "js/…"}}` (never a hand-written `?v=` — tokens are content hashes, see `asset_hash.go`); a script fetched at runtime goes in `lazyLoadedAssets` instead
- [ ] `dashboard.js` lines: before ___ → after ___
- [ ] Smoke checklist: [docs/dashboard-smoke-checklist.md](../docs/dashboard-smoke-checklist.md)

## Test plan

- [ ] Hand smoke (5 min)
- [ ] Playwright `npm run test:e2e` (if configured)
