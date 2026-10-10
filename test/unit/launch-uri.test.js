'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseGameTarget, describeTarget, buildRobloxPlayerUri } = require('../../src/main/roblox/launch-uri');

const JOB = '6f3c9f9e-1c2d-4a5b-8c7d-0123456789ab';

test('parses the supported game target formats', () => {
  const cases = [
    ['920587237', { placeId: 920587237, linkCode: null, jobId: null }],
    ['  1818  ', { placeId: 1818, linkCode: null, jobId: null }],
    ['https://www.roblox.com/games/2753915549/Blox-Fruits', { placeId: 2753915549, linkCode: null, jobId: null }],
    ['https://www.roblox.com/es/games/2753915549/Blox-Fruits', { placeId: 2753915549, linkCode: null, jobId: null }],
    ['https://www.roblox.com/experiences/2753915549', { placeId: 2753915549, linkCode: null, jobId: null }],
    ['https://www.roblox.com/games/123/x?privateServerLinkCode=AbC_12-x', { placeId: 123, linkCode: 'AbC_12-x', jobId: null }],
    [`https://www.roblox.com/games/start?placeId=920587237&gameInstanceId=${JOB}`, { placeId: 920587237, linkCode: null, jobId: JOB }],
    [`920587237 ${JOB.toUpperCase()}`, { placeId: 920587237, linkCode: null, jobId: JOB }],
    ['roblox://placeId=1818', { placeId: 1818, linkCode: null, jobId: null }],
    ['roblox://experiences/start?placeId=606849621', { placeId: 606849621, linkCode: null, jobId: null }],
  ];
  for (const [input, expected] of cases) assert.deepEqual(parseGameTarget(input), expected, input);
});

test('rejects things that are not a game', () => {
  assert.deepEqual(parseGameTarget(''), { error: 'GAME_REQUIRED' });
  assert.deepEqual(parseGameTarget('hello world'), { error: 'GAME_TARGET_INVALID' });
  assert.deepEqual(parseGameTarget('https://www.roblox.com/users/123456789/profile'), { error: 'GAME_TARGET_INVALID' });
  assert.deepEqual(parseGameTarget('https://www.roblox.com/groups/4199740/x'), { error: 'GAME_TARGET_INVALID' });
  assert.deepEqual(parseGameTarget('https://www.roblox.com/share?code=abc123&type=Server'), { error: 'SHARE_LINK_UNSUPPORTED' });
  assert.deepEqual(parseGameTarget('9'.repeat(501)), { error: 'GAME_TARGET_INVALID' });
  assert.deepEqual(parseGameTarget('99999999999999999999'), { error: 'GAME_TARGET_INVALID' });
});

test('private server links ignore any job id', () => {
  const t = parseGameTarget(`https://www.roblox.com/games/5/x?privateServerLinkCode=abc&gameInstanceId=${JOB}`);
  assert.equal(t.linkCode, 'abc');
  assert.equal(t.jobId, null);
});

test('describes targets for the UI', () => {
  assert.equal(describeTarget({ placeId: 5, linkCode: null, jobId: null }), 'Place 5');
  assert.equal(describeTarget({ placeId: 5, linkCode: 'x', jobId: null }), 'Private server · place 5');
  assert.match(describeTarget({ placeId: 5, linkCode: null, jobId: JOB }), /^Server 6f3c9f9e… · place 5$/);
});

test('builds the same roblox-player URI format as earlier versions', () => {
  const uri = buildRobloxPlayerUri('TICKET123', { placeId: 1818, linkCode: null, jobId: null }, 1700000000000);
  const m = uri.match(/^roblox-player:1\+launchmode:play\+gameinfo:TICKET123\+launchtime:1700000000000\+placelauncherurl:(.+)\+browsertrackerid:(\d+)\+robloxLocale:en_us\+gameLocale:en_us$/);
  assert.ok(m, uri);
  assert.equal(m[1], `https://assetgame.roblox.com/game/PlaceLauncher.ashx?request=RequestGameJob&browserTrackerId=${m[2]}&placeId=1818&isPlayTogetherGame=false`);
  assert.ok(Number(m[2]) >= 1e15 && Number.isSafeInteger(Number(m[2])));
});

test('adds private server and job parameters', () => {
  assert.match(buildRobloxPlayerUri('T', { placeId: 1, linkCode: 'abc_1', jobId: null }), /isPlayTogetherGame=false&linkCode=abc_1\+/);
  assert.match(buildRobloxPlayerUri('T', { placeId: 1, linkCode: null, jobId: JOB }), new RegExp(`&gameId=${JOB}\\+`));
});

test('refuses tickets or targets that could inject URI parts', () => {
  assert.throws(() => buildRobloxPlayerUri('bad ticket+launchmode:x', { placeId: 1 }), /AUTH_TICKET_FAILED/);
  assert.throws(() => buildRobloxPlayerUri('T', { placeId: '1+evil' }), /GAME_TARGET_INVALID/);
  assert.doesNotMatch(buildRobloxPlayerUri('T', { placeId: 1, linkCode: 'a+b', jobId: null }), /linkCode/);
});
