// Finds the newest published release on GitHub and points every download
// button at its installer, so the site never needs editing for a release.
// Falls back to the "latest release" page if the API can't be reached.

export const REPO = 'Sacttt/roblox-account-manager';
export const REPO_URL = `https://github.com/${REPO}`;
export const LATEST_PAGE = `${REPO_URL}/releases/latest`;
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const CACHE_KEY = 'ram-site-release-v1';
const CACHE_MS = 15 * 60 * 1000;

function readCache() {
  try {
    const c = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
    return c && Date.now() - c.at < CACHE_MS ? c.data : null;
  } catch (_) {
    return null;
  }
}

function writeCache(data) {
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data })); } catch (_) { /* private mode */ }
}

const isGitHubDownload = (url) => typeof url === 'string' && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/releases\/download\//.test(url);

function pickAssets(assets = []) {
  const exes = assets.filter((a) => /\.exe$/i.test(a.name) && isGitHubDownload(a.browser_download_url));
  const installer = exes.find((a) => /setup/i.test(a.name)) || exes.find((a) => !/portable/i.test(a.name)) || null;
  const portable = exes.find((a) => /portable/i.test(a.name)) || null;
  const slim = (a) => (a ? { name: a.name, url: a.browser_download_url, size: a.size } : null);
  return { installer: slim(installer), portable: slim(portable) };
}

export async function loadRelease() {
  const cached = readCache();
  if (cached) return cached;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7000);
  try {
    const res = await fetch(API, { headers: { Accept: 'application/vnd.github+json' }, signal: ctrl.signal });
    if (!res.ok) return null;
    const r = await res.json();
    if (!r || r.draft || r.prerelease || typeof r.tag_name !== 'string') return null;
    const data = {
      version: r.tag_name.replace(/^v/i, ''),
      page: typeof r.html_url === 'string' && r.html_url.startsWith(REPO_URL) ? r.html_url : LATEST_PAGE,
      published: r.published_at || null,
      ...pickAssets(r.assets),
    };
    writeCache(data);
    return data;
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const mb = (bytes) => `${Math.round(bytes / 1048576)} MB`;
const niceDate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

export function applyRelease(rel) {
  const href = rel && rel.installer ? rel.installer.url : (rel ? rel.page : LATEST_PAGE);
  document.querySelectorAll('[data-download]').forEach((a) => {
    a.href = href;
    if (rel && rel.installer) a.setAttribute('download', '');
  });
  if (!rel) return;

  const label = rel.installer ? `Download v${rel.version} for Windows` : `Get v${rel.version} on GitHub`;
  document.querySelectorAll('[data-download-label]').forEach((el) => { el.textContent = label; });
  document.querySelectorAll('[data-portable]').forEach((a) => { a.href = rel.portable ? rel.portable.url : rel.page; });
  document.querySelectorAll('[data-version-pill]').forEach((el) => { el.textContent = `Latest: v${rel.version}`; });
  document.querySelectorAll('[data-file-name]').forEach((el) => { el.textContent = rel.installer ? rel.installer.name : `version ${rel.version}`; });

  const meta = document.querySelector('[data-download-meta]');
  if (meta) {
    const parts = [`v${rel.version}`];
    if (rel.published) parts.push(`released ${niceDate(rel.published)}`);
    if (rel.installer) parts.push(`${mb(rel.installer.size)} installer for Windows 10/11 (64-bit)`);
    meta.textContent = `${parts.join(' · ')} · `;
    const notes = document.createElement('a');
    notes.href = rel.page;
    notes.textContent = 'release notes';
    notes.target = '_blank';
    notes.rel = 'noopener';
    meta.append(notes);
    if (rel.portable) {
      meta.append(' · ');
      const p = document.createElement('a');
      p.href = rel.portable.url;
      p.textContent = 'portable version';
      meta.append(p);
    }
  }
  const finalEl = document.querySelector('[data-final-version]');
  if (finalEl) finalEl.textContent = `Version ${rel.version} · free download for Windows 10 & 11.`;
}
