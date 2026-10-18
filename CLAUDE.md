# ibadhasan.com and The Lair

Personal site of Ibad Hasan. The owner is not a developer: keep explanations plain and short. Time zone: Asia/Dubai.

## Hard rules
- This repo is PUBLIC. Never commit passwords, keys, tokens, `.env`, `serviceAccountKey.json` or any of his files (Drive/, Photography/, Movies/).
- Personal only. Nothing from his work (Al Ghurair) goes here, and personal work never touches the work hub repo's `hub/`, `receiver/` or workflows.
- Pushing to `main` publishes the site within 1-2 minutes (GitHub Pages). Show him the change and get his OK in chat first, and test at phone, iPad and desktop widths, light and dark mode.
- Keep it light on data and battery (his iPhone runs hot): previews not originals, no heavy animation or blur on phones, no constant polling.

## How it fits together
- Website (this repo): static pages. `/` homepage, `/lair` The Lair (his private hub), `admin.html` settings.
- `lair-edge` (private repo `cryeteria16/lair-edge`): Cloudflare Worker + D1 at `api.ibadhasan.com`. Always on. Sign-in, watchlist, settings, visitor radar, homepage photo previews, PC status. Pushing to its `main` deploys it by GitHub Actions (tests first). Secrets live in that repo's Actions secrets, never in chat.
- `lair-server` (private repo `cryeteria16/admin-dashboard`, folder `lair-server/`): Node server on his home PC at `vault.ibadhasan.com` (Cloudflare tunnel, port 3005). Vault drive (100 GB), movies, TMDB search, exhibition previews. Pushing `lair-server/` to that repo's `main` deploys it: the PC updates itself within ~2 minutes. Test first.
- Firebase is retired and nothing uses `serviceAccountKey.json` any more. Fridge Door and Fridge Magnet were removed on purpose.
- Look: "Night Glass" (dark, Apple-style glass, a hint of Frutiger). Real blur only on the tab bar, top buttons, sheets and dialogs; cards fake it.

## What works with the PC off
Works: homepage, sign-in, watchlist, settings, visitor radar, PC status, exhibition photo previews.
Needs the PC: Vault files, movies, TMDB search, adding photos to the homepage.

## Sign-in
Owner only, password only. The password is the `LAIR_PASSWORD` secret in `lair-edge`; changing it means updating that secret and re-running the deploy. Sessions last 60 days, can be signed out from settings.

## Installing on the PC
`lair-server/setup.cmd` (first time), `boot-start.cmd` (start at Windows boot, needs his Windows password), `stop-lair.cmd`.

## Plan (agreed with Ibad, Oct 2026). Do in this order, show him before publishing each.
1. Face ID sign-in (passkeys): done on branch `face-id`, helper routes `/auth/passkey/*`.
2. Photos library (DONE, live Oct 2026): timeline by date (from the photo itself), albums, favourites, "on this day". No map.
   Phone backup, on demand only (never automatic): (A) "Back up" button with the photo picker, (B) a one-tap iPhone Shortcut with an upload-only key that can be revoked in Settings. Skip duplicates; keep originals; folders Photos/iPhone/YYYY-MM.
3. Documents: camera scanner to PDF, search inside PDFs and scans (text read on the PC), important dates (Emirates ID, passport, visa, car) shown on Home.
4. Safety: app-style install, nightly cloud backup of chosen Vault folders (Cloudflare R2, he sets up the bucket), sign-in activity log in Settings.
5. Share links (expiry, optional password) and a drop-box link; Movies & TV library with continue watching.
6. Everyday: notes and lists, search everything, Dubai weather on Home, read-later, trackers.
Not wanted (don't build): notifications (later), photo map, PC controls, storage cleanup, Fridge Door/Magnet.
