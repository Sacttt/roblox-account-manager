# Project website

A static site (plain HTML, CSS and JavaScript modules — no build step, no
dependencies, no trackers). It is published to GitHub Pages by
`.github/workflows/pages.yml` whenever something in `website/` changes on
`main`.

**One-time setup:** in the repository go to *Settings → Pages* and set
*Source* to **GitHub Actions**. The site then appears at
`https://sacttt.github.io/roblox-account-manager/`.

## Preview locally

Any static file server works, for example:

```
npx --yes http-server website -p 8080
```

Opening `index.html` directly from disk will not work, because browsers do
not load JavaScript modules from `file://` pages.

## How the download button works

`js/release.js` asks the GitHub API for the latest published (non-draft,
non-prerelease) release and links straight to its `…Setup-x.y.z.exe`
installer, plus the portable `.exe` if present. The answer is cached for 15
minutes per visitor. If the API can't be reached, or the release has no
installer attached, the buttons fall back to the release page on GitHub, so
they always lead somewhere useful.

## Updating the screenshots

The screenshots are taken from the real app, filled with made-up demo
accounts served by the test mock (nothing talks to Roblox):

```
npm ci
xvfb-run -a node scripts/screenshots.js website/assets/screens --webp
```

(`xvfb-run` is only needed on Linux without a display; ImageMagick's
`convert` is needed for `--webp`.)

To use your own pictures for the demo accounts, put up to six images
(`.png`, `.jpg` or `.webp`) in `website/demo-avatars/` — they are used in
name order — and run the command above. This also refreshes
`assets/demo/avatar-1…6.webp` used by the interactive demo. The
`demo-avatars` folder itself is not published.

## Files

| Path | What it is |
| --- | --- |
| `index.html` | The page |
| `styles.css` | All styles (same colors as the app's Midnight theme) |
| `js/site.js` | Wires everything up |
| `js/release.js` | Latest-release lookup for the download buttons |
| `js/gallery.js` | Screenshot tabs and zoom |
| `js/demo.js` | The interactive "Launch Together" demo |
| `js/bubbles.js` | Background bubbles and click bursts |
| `js/sound.js` | Click sounds (synthesized, can be muted) |
