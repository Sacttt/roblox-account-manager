# Roblox Account Manager

A local, offline-first desktop app for organizing multiple Roblox accounts: nicknames, notes,
favorites, pinning, live avatars/display names pulled from Roblox's public profile API, search,
sort, and a one-click hand-off into Roblox's own sign-in flow.

## Running several accounts at once

1. Add each account with **Sign In** (Roblox's real login page) or by pasting its `.ROBLOSECURITY` cookie.
2. Make sure **Settings → Multi Roblox** is on and Roblox is closed.
3. Enter a Place ID / game link, select accounts, and press **Launch Together**.

How it works:

- **Per-account login.** Each launch asks Roblox for a one-time auth ticket for that account (the
  same thing roblox.com's Play button does) and passes it to the Roblox app, so each window signs
  in as the right account. The previous version opened `roblox://experiences/start`, which always
  used whoever was signed into the Roblox app. That's why only one account ever opened.
- **Multi Roblox.** Roblox allows one window by checking a "singleton" mutex. A small hidden
  PowerShell helper (`multiroblox.js`) creates and holds that mutex *before* the first client
  starts, and locks `RobloxCookies.dat` to prevent error 773. This is the same approach
  evanovar/RobloxAccountManager uses. It must start while Roblox is closed; the app offers to close
  Roblox for you if needed. The helper exits automatically when this app closes.
- **Launch Together** starts accounts one at a time and waits until each new Roblox window
  appears (plus the delay you pick in Settings) before starting the next.
- **Launcher.** Automatic uses Bloxstrap or Fishstrap if installed, otherwise the official Roblox
  launcher. You can force one in Settings.

Security: cookies are encrypted with Windows DPAPI (Electron `safeStorage`) in `accounts.json`,
never sent to the UI, and never included in exported backups. A cookie gives full access to an
account, so never share one or an `rbx-player`/`roblox-player` link.

Heads up: Roblox's anti-cheat vendor has said running multiple clients may be treated as
suspicious, and farming/trading abuse with alts is against Roblox's Terms. Use at your own risk.

## Requirements

- [Node.js](https://nodejs.org) (LTS version) — the build script will tell you if it's missing.
- Windows, for the `build.bat` script below. (macOS/Linux: run `npm install && npm run start`
  to try it, or adjust the `build` script in `package.json` to `electron-builder --mac` / `--linux`.)

## Building your exe

1. Unzip this project anywhere.
2. Double-click **`build.bat`**.
3. Wait for it to finish — it installs dependencies, then builds.
4. Your app is in the `dist` folder as a portable `.exe`.

Run `build.bat` again any time you change the code (or if I send you an updated version of the
project) to produce a fresh, updated `.exe`.

## Running without building (for testing)

```
npm install
npm start
```

## Where your data lives

All account data is stored locally in your Windows user data folder (cookies encrypted). Nothing
is sent anywhere except requests to Roblox's own API (profiles, avatars, presence, launch tickets). You can open that folder any time from Settings → "Open
data folder", and clear the avatar cache from the same screen.

## Project structure

```
main.js         Electron main process: window, encrypted storage, Roblox API calls, launch handling
multiroblox.js  Multi Roblox helper (singleton mutex + error 773 cookie lock), Roblox process list
preload.js      Secure bridge between main process and UI
src/index.html  App shell
src/style.css   Theme and layout
src/renderer.js UI logic: rendering, search/sort, modals, toasts
build.bat       One-click install + build script (Windows)
```
