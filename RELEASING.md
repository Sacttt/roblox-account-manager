# Releasing & updates

The app updates itself with **electron-updater**, using **GitHub Releases** as the feed. The
version lives in one place: `"version"` in `package.json`.

Each release contains:

| File | What it is |
| --- | --- |
| `RobloxAccountManager-Setup-<version>.exe` | Installer (per-user, no admin). Installed copies update from this. |
| `RobloxAccountManager-Portable-<version>.exe` | Portable app. Doesn't update itself; users download the new one. |
| `latest.yml`, `…Setup-<version>.exe.blockmap` | Update metadata (version, SHA-512 hash, size). Needed by the updater. |

The website's download button always points at the installer of the **latest published**
release (drafts and pre-releases are ignored), so publishing a release updates the site too.

## How updating works for users

- The installed app checks GitHub shortly after start and then every 6 hours. It never
  downloads on its own: the user sees the new version and its release notes and chooses
  **Download update**, then **Restart & update**.
- Downloads are verified against the SHA-512 in `latest.yml` over HTTPS before installing.
- Put `[critical]` anywhere in the release notes to mark a required update: the prompt then
  says so and has no "Later" button.
- Portable copies show a link to the releases page instead of updating.
- Running from source (`npm start`) never checks for updates. To try the updater from source,
  run with `RAM_TEST_UPDATES=1` (uses `dev-app-update.yml`).

## Publishing a release

1. Bump `"version"` in `package.json` (for example `2.0.1`), update `CHANGELOG.md`, commit and
   push to `main`.
2. Pick one:
   - **On GitHub's servers (recommended):** push a matching tag:
     ```
     git tag v2.0.1
     git push origin v2.0.1
     ```
     or run *Actions → Release → Run workflow*. The workflow checks the tag matches
     `package.json`, runs lint and unit tests, builds on Windows and uploads everything to a
     **draft** release. No personal token needed.
   - **From your PC:** create a token with `repo` scope at
     https://github.com/settings/tokens, then in a terminal in the project folder:
     ```
     set GH_TOKEN=ghp_your_token_here
     release.bat
     ```
     The token stays in that terminal window only. Never commit it.
3. Open the draft on the Releases page, check the files are attached, write the release notes
   (they're shown in the app) and press **Publish**.

## Before publishing: test the build

Every push already runs CI (lint, unit tests, end-to-end tests and a Windows build). To try the
exact installer before releasing, open the CI run for your commit, download the
`roblox-account-manager-windows` artifact and install it on a Windows PC.

Check at least:

| Check | How |
| --- | --- |
| Installs without admin | Run the Setup exe as a normal user; app opens after install |
| Data carried over | Install over a previous version; accounts and sign-ins are still there |
| Version | *Settings → About & updates* shows the new version |
| Launch | Launch one account, then Launch Together with two (Multi Roblox on) |
| Update path | Install the previous release, publish the new one, open the old app → update offered, downloads, restarts on the new version |
| Offline | Start with no network → no crash; status shows unknown/outdated, not fake |
| Uninstall | *Settings → Apps* → uninstall; data folder stays in `%APPDATA%\roblox-account-manager` |

## Code signing (optional)

Without a certificate the app works and updates are still integrity-checked, but Windows
SmartScreen warns on first run. To sign, provide `CSC_LINK` (path or base64 of a `.pfx`) and
`CSC_KEY_PASSWORD` to the build — as GitHub Actions secrets for the Release workflow (and remove
`CSC_IDENTITY_AUTO_DISCOVERY: "false"` there), or as environment variables for `release.bat`.
Never commit them.

## Building on Linux

`npm run build` also works on Linux if Wine is installed (`wine64` plus 32-bit `wine32`), which
is useful for checking a build without a Windows PC. Test the result on real Windows.

## The website

`website/` is published to GitHub Pages by `.github/workflows/pages.yml` whenever it changes on
`main`. One-time setup: *Settings → Pages → Source: GitHub Actions*. See
[website/README.md](website/README.md).
