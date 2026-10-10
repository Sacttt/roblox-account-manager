'use strict';

const fs = require('fs');
const path = require('path');

const SCHEME = 'app';
const HOST = 'ram';
const ORIGIN = `${SCHEME}://${HOST}`;
const RENDERER_DIR = path.join(__dirname, '..', 'renderer');
const ASSETS_DIR = path.join(__dirname, '..', '..', 'assets');

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

function privilegedSchemes() {
  return [{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } }];
}

const notFound = () => new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });

/**
 * Serves the renderer from app://ram/ (a real origin, so ES modules and a
 * strict CSP work) plus cached avatars and custom icons. Paths are resolved
 * strictly inside their folders; anything else is a 404.
 */
function registerAppProtocol(protocol, { avatars }) {
  protocol.handle(SCHEME, async (request) => {
    let url;
    try { url = new URL(request.url); } catch (_) { return notFound(); }
    if (url.host !== HOST) return notFound();
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch (_) { return notFound(); }

    const avatar = pathname.match(/^\/avatar\/(\d{1,20})$/);
    if (avatar) {
      const img = avatars.readAvatar(avatar[1]);
      return img ? new Response(img.data, { headers: { 'content-type': img.mime, 'cache-control': 'max-age=31536000, immutable' } }) : notFound();
    }
    const icon = pathname.match(/^\/icon\/([\w-]{3,64})$/);
    if (icon) {
      const img = avatars.readIcon(icon[1]);
      return img ? new Response(img.data, { headers: { 'content-type': img.mime, 'cache-control': 'max-age=31536000, immutable' } }) : notFound();
    }

    const asset = pathname.match(/^\/assets\/([\w.-]{1,64})$/);
    const baseDir = asset ? ASSETS_DIR : RENDERER_DIR;
    const rel = asset ? asset[1] : (pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, ''));
    const file = path.normalize(path.join(baseDir, rel));
    if (!file.startsWith(baseDir + path.sep)) return notFound();
    try {
      const data = await fs.promises.readFile(file);
      const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
      const headers = { 'content-type': type, 'x-content-type-options': 'nosniff' };
      if (type.startsWith('text/html')) headers['content-security-policy'] = CSP;
      return new Response(data, { headers });
    } catch (_) {
      return notFound();
    }
  });
}

module.exports = { privilegedSchemes, registerAppProtocol, ORIGIN, CSP };
