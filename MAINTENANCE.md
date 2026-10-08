# Maintenance log

GitHub disables scheduled workflows after **60 days without repository activity**.
This repo runs `.github/workflows/render-keepalive.yml`, which pings the Render
content engine so it does not spin down. If that workflow is disabled, the events
crawler host goes cold and event pages stop refreshing.

**To reset the clock: push any commit.** Adding a dated line below is enough.
Use `[skip ci]` in the commit message so Vercel does not redeploy.

## Health checks

- 2026-10-07 — Full audit. Render service up, 653 upcoming events, all four
  live sites returning 200. Bluesky, Substack, Threads and X all delivering.
  Supabase management token found expired and needs rotating.
- 2026-08-13 — Last code change before this entry.
