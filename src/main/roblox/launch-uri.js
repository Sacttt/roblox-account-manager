'use strict';

const crypto = require('crypto');

const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Parses what a user may type into the game bar:
 *   12345678
 *   https://www.roblox.com/games/12345678/Name
 *   https://www.roblox.com/games/12345678/Name?privateServerLinkCode=abc
 *   https://www.roblox.com/games/start?placeId=123&gameInstanceId=<guid>
 *   roblox://placeId=123  /  roblox://experiences/start?placeId=123
 *   "12345678 <job-guid>"
 * Returns { placeId, linkCode, jobId } or { error }.
 */
function parseGameTarget(input) {
  const text = String(input || '').trim();
  if (!text) return { error: 'GAME_REQUIRED' };
  if (text.length > 500) return { error: 'GAME_TARGET_INVALID' };

  if (/roblox\.com\/share\?/i.test(text) || /[?&]code=[^&]+&type=Server/i.test(text)) {
    return { error: 'SHARE_LINK_UNSUPPORTED' };
  }

  let placeId = null;
  let linkCode = null;
  let jobId = null;

  const link = text.match(/privateServerLinkCode=([A-Za-z0-9_-]{1,100})/i);
  if (link) linkCode = link[1];

  const job = text.match(/(?:gameInstanceId|gameId|jobId)=([0-9a-f-]{36})/i) || text.match(GUID);
  if (job && GUID.test(job[1] || job[0])) jobId = (job[1] || job[0]).toLowerCase();

  const fromPath = text.match(/roblox\.com\/(?:[a-z]{2}\/)?(?:games|experiences)\/(\d{1,15})/i);
  const fromQuery = text.match(/[?&]placeId=(\d{1,15})/i) || text.match(/placeId=(\d{1,15})/i);
  if (fromPath) placeId = fromPath[1];
  else if (fromQuery) placeId = fromQuery[1];
  else if (/^\d{1,15}$/.test(text)) placeId = text;
  else {
    const loose = text.replace(GUID, ' ').match(/\b(\d{4,15})\b/);
    if (loose) placeId = loose[1];
  }

  const id = placeId ? Number(placeId) : null;
  if (!id || !Number.isSafeInteger(id)) return { error: 'GAME_TARGET_INVALID' };
  return { placeId: id, linkCode, jobId: linkCode ? null : jobId };
}

function describeTarget(t) {
  if (!t || t.error) return '';
  if (t.linkCode) return `Private server · place ${t.placeId}`;
  if (t.jobId) return `Server ${t.jobId.slice(0, 8)}… · place ${t.placeId}`;
  return `Place ${t.placeId}`;
}

/**
 * Builds the roblox-player: URI the website's Play button hands to the
 * Roblox client. The embedded one-time ticket is what makes the client sign
 * in as this specific account. The place-launcher URL is percent-encoded the
 * same way roblox.com does it.
 */
function buildRobloxPlayerUri(ticket, { placeId, linkCode, jobId }, now = Date.now()) {
  if (!/^[A-Za-z0-9_\-+/=.]+$/.test(String(ticket || ''))) throw new Error('AUTH_TICKET_FAILED');
  const tracker = String(100000000000 + crypto.randomInt(0, 899999999999));
  let request = 'RequestGame';
  let extra = '';
  if (linkCode) { request = 'RequestPrivateGame'; extra = `&linkCode=${encodeURIComponent(linkCode)}`; }
  else if (jobId) { request = 'RequestGameJob'; extra = `&gameId=${encodeURIComponent(jobId)}`; }
  const launcher = `https://assetgame.roblox.com/game/PlaceLauncher.ashx?request=${request}`
    + `&browserTrackerId=${tracker}&placeId=${placeId}${extra}&isPlayTogetherGame=false`;
  return [
    'roblox-player:1',
    'launchmode:play',
    `gameinfo:${ticket}`,
    `launchtime:${now}`,
    `placelauncherurl:${encodeURIComponent(launcher)}`,
    `browsertrackerid:${tracker}`,
    'robloxLocale:en_us',
    'gameLocale:en_us',
  ].join('+');
}

module.exports = { parseGameTarget, describeTarget, buildRobloxPlayerUri };
