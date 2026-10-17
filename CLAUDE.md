# ibadhasan.com and The Lair

Personal site of Ibad Hasan. The owner is not a developer: keep explanations plain and short. Time zone: Asia/Dubai.

## Hard rules
- This repo is PUBLIC. Never commit passwords, keys, tokens, `.env`, `serviceAccountKey.json` or any of his files (Drive/, Photography/, Movies/).
- Personal only. Nothing from his work (Al Ghurair) goes here, and personal work never touches the work hub repo's `hub/`, `receiver/` or workflows.
- Pushing to `main` publishes the site within 1-2 minutes (GitHub Pages). Show him the change and get his OK in chat first, and test at phone, iPad and desktop widths, light and dark mode.
- Keep it light on data and battery (his iPhone runs hot): previews not originals, no heavy animation or blur on phones, no constant polling.

## How it fits together
- Website (this repo): static pages. `/` homepage, `/lair` The Lair (his private hub), `admin.html` settings.
- `lair-edge` (private repo `cryeteria16/lair-edge`): Cloudflare Worker + D1 at `api.ibadhasan.com`. Always on. Sign-in, Fridge Door, watchlist, settings, visitor radar, homepage photo previews, PC status. Pushing to its `main` deploys it by GitHub Actions (tests first). Secrets live in that repo's Actions secrets, never in chat.
- `lair-server` (private repo `cryeteria16/admin-dashboard`, folder `lair-server/`): Node server on his home PC at `vault.ibadhasan.com` (Cloudflare tunnel, port 3005). Vault drive (100 GB), movies, TMDB search, Fridge Magnet and the Fridge Google Sheet log. Pushing `lair-server/` to that repo's `main` deploys it: the PC updates itself within ~2 minutes. Test first.
- Firebase is retired. `serviceAccountKey.json` on the PC is only for the Fridge Google Sheet.

## What works with the PC off
Works: homepage, sign-in, Fridge Door notes, watchlist, settings, visitor radar, PC status, exhibition photo previews.
Needs the PC: Vault files, movies, TMDB search, Fridge Magnet save and Sheet log.

## Sign-in
Owner only, password only. The password is the `LAIR_PASSWORD` secret in `lair-edge`; changing it means updating that secret and re-running the deploy. Sessions last 60 days, can be signed out from settings.

## Installing on the PC
`lair-server/setup.cmd` (first time), `boot-start.cmd` (start at Windows boot, needs his Windows password), `stop-lair.cmd`.
