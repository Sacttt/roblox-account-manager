# Changelog

## 2.0.0

A ground-up rebuild. Your accounts, sign-ins, nicknames, notes, groups, favorites, custom icons,
saved games and settings from 1.x are carried over automatically on first start.

### New

- New interface: sidebar, dashboard, account cards and a compact table view, details panel,
  command palette (Ctrl K), keyboard shortcuts, toasts and confirmations for destructive actions.
- Unlimited accounts with nicknames, groups, tags, private notes, favorites and pins; search,
  filters (favorites, online, ready to launch, needs attention, group, tag) and sorting.
- Bulk actions on selected accounts: launch together, add to/remove from favorites, move to a
  group, add a tag, refresh, remove.
- Sign-in health for every account (verified, expired, missing) with one-click "Sign in again".
- Adding an account shows who it is before saving and detects accounts already in the list.
- Launch Together with progress, cancel, and a clear message for each account that fails.
  Only one launch runs at a time, and relaunching an account opened in the last 30 seconds
  asks first.
- Launch links: Place IDs, game links (any language), private server links, specific servers
  and `roblox://` links. Saved games and recent games.
- Activity history, backups of your organization (never sign-ins) with restore, diagnostics
  with a secret-free report and connection check.
- System tray with quick launch, optional start with Windows, optional global show/hide
  shortcut, desktop notification when a background launch finishes.
- 8 themes including light, custom accent color, compact density, reduced motion.
- Installer that needs no administrator rights, plus a portable version.
- Project website with direct download of the latest release.

### Improved

- Sign-ins are stored separately from the account list (`secrets.json`), encrypted with
  Windows DPAPI, and still never sent to the app's UI.
- Secrets are removed from logs, activity history, diagnostics, error messages and backups.
- Roblox requests have timeouts, retries with backoff, shared rate-limit handling and no
  duplicate requests; live status is fetched in batches and always shows how fresh it is.
- Data files are written atomically with automatic backups and recovery from damaged files.
- Updates are checked from GitHub but only downloaded when you choose to.
- The renderer runs sandboxed with a strict Content Security Policy; every request from the
  UI is validated in the main process.

### Fixed

- When Windows encryption wasn't available, 1.x saved sign-ins to `accounts.json` in plain
  text. 2.0 never writes them unencrypted; they are kept in memory for that session instead.
- Brookhaven in the default saved games pointed to the wrong place.
- `build.bat` no longer requires running as administrator.

### Notes

- Data folder: `%APPDATA%\roblox-account-manager`. Before converting 1.x data the app saves
  `accounts.pre-v2-backup.json` (without sign-ins) and `settings.pre-v2-backup.json` there.
- Requires Windows 10/11 64-bit. Building from source requires Node.js 22+.
