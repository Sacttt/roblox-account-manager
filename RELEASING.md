# Releasing & auto-updates

This app auto-updates with **electron-updater** using **GitHub Releases** as the
feed. Updates download in the background, are verified against the SHA512 in the
release metadata over HTTPS (and the installer's Authenticode signature too, if
you code-sign), and install on restart. The current version is always the
`version` field in `package.json` — the only place it's defined.

Your account is already wired in: `owner: Sacttt`, `repo: roblox-account-manager`
(set in `package.json` and `dev-app-update.yml`).

## One-time setup (you must do this — needs your GitHub login)

1. **Create the repo** `roblox-account-manager` under your account at
   https://github.com/new — make it **Public** (public means your users need no
   login to receive updates). Don't rename it, or update the two files above to match.
2. **Put the code in the repo** (from the `roblox-manager` folder), either with
   GitHub Desktop, or in a terminal there:
   ```
   git init
   git add .
   git commit -m "Roblox Account Manager"
   git branch -M main
   git remote add origin https://github.com/Sacttt/roblox-account-manager.git
   git push -u origin main
   ```
   (A `.gitignore` already excludes `node_modules/` and `dist/`.)
3. *(Optional, recommended)* **Code signing.** Without it, updates still work and
   are integrity-checked via SHA512 over HTTPS, but Windows SmartScreen warns on
   install and electron-updater can't verify a publisher signature. To sign, set
   `CSC_LINK` (path/base64 of your .pfx) and `CSC_KEY_PASSWORD` in the build
   environment only. Never commit them.

## Publishing a release — pick ONE path

### Path A — from your PC (simplest, matches release.bat)

1. Create a GitHub token with `repo` scope: https://github.com/settings/tokens
2. In the terminal, in the project folder:
   ```
   set GH_TOKEN=ghp_your_token_here
   ```
   (The token lives only in that window — never in the app.)
3. Bump `"version"` in `package.json`, then double-click **`release.bat`**.

`release.bat` runs `npm run release`, which builds the NSIS installer and uploads
`Roblox Account Manager-Setup-<version>.exe`, `latest.yml`, and the `.blockmap`
to a **draft** GitHub release. Open the releases page, paste your changelog, and
**Publish**. Installed copies pick it up.

### Path B — on GitHub's servers (no local token, no build wait)

The included `.github/workflows/release.yml` builds and publishes for you when you
push a version tag. After the repo is pushed once:
```
git tag v1.0.1
git push origin v1.0.1
```
GitHub builds the Windows installer and creates the release automatically (using
its built-in token). Bump `"version"` in `package.json` to match the tag first.

- **Release notes**: whatever you write in the GitHub release body shows in the
  in-app "What's new" panel.
- **Mark a release critical/required** (optional): put `[critical]` anywhere in
  the release notes. The in-app prompt then hides "Later" so the user updates
  before continuing. Leave it out for normal updates.

- **Release notes**: whatever you write in the GitHub release body shows in the
  in-app "What's new" panel.
- **Mark a release critical/required** (optional): put `[critical]` anywhere in
  the release notes. The in-app prompt then hides "Later" so the user updates
  before continuing. Leave it out for normal updates.

## Testing

1. **Development** (`npm start`): update checks are OFF by design, so you never
   hit a missing-config error. The About card shows the version; "Check for
   updates" says updates only run in the installed app.
2. **Local packaged build** (`npm run build`): produces `dist/…Setup.exe` with
   `--publish never`. Install it to confirm the app runs, the window/titlebar,
   and that the About card shows the right version.
3. **Test release**: bump the version to a prerelease (e.g. `1.0.1`), publish to
   GitHub, install the PREVIOUS version, launch it, and confirm the prompt.
   To test from a dev run without installing, launch with the feed enabled:
   ```
   set RAM_TEST_UPDATES=1
   npm start
   ```
   (uses `dev-app-update.yml`).
4. **Production release**: the normal loop above.

**What to verify**

| Check | How |
| --- | --- |
| Version detection | About card shows `package.json` version |
| Update available | Install older version, publish newer, relaunch → prompt appears |
| Downloading | Click Update Now → progress bar advances |
| Installation | Download complete → Restart & Install → app reopens on new version |
| Restart behavior | App relaunches automatically after install |
| Release notes | GitHub release body appears in "What's new" |
| Failed download | Disconnect mid-download → clear error, current version still works, Retry offered |
| Offline | No network at launch → no crash, "up to date"/silent, app usable |
| Already up to date | Same version installed → "You're up to date." |

## What infrastructure you actually need

- A **public GitHub repository** with **Releases** (the only hosting required).
  Your users download updates from there with no account or token.
- To publish: **either** a `GH_TOKEN` on your PC (Path A) **or** the included
  Actions workflow with no token at all (Path B).
- *(Optional)* a **code-signing certificate** (`CSC_LINK` / `CSC_KEY_PASSWORD`).
- No server of your own.
