'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readJSON, writeJSON, debouncedWriter } = require('../../src/main/json-store');
const { Vault } = require('../../src/main/vault');

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ram-test-'));

test('json-store: atomic write keeps the previous version as .bak', () => {
  const dir = tmpdir();
  const file = path.join(dir, 'a.json');
  writeJSON(file, { v: 1 });
  writeJSON(file, { v: 2 });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { v: 2 });
  assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8')), { v: 1 });
  assert.deepEqual(fs.readdirSync(dir).sort(), ['a.json', 'a.json.bak']);
});

test('json-store: recovers from a corrupt file and keeps the damaged copy', () => {
  const dir = tmpdir();
  const file = path.join(dir, 'a.json');
  writeJSON(file, { v: 1 });
  writeJSON(file, { v: 2 });
  fs.writeFileSync(file, '{"v": 2, broken');
  const r = readJSON(file, { v: 0 });
  assert.equal(r.source, 'backup');
  assert.deepEqual(r.data, { v: 1 });
  assert.ok(r.recoveredFrom && fs.existsSync(r.recoveredFrom), 'damaged file is kept aside');
});

test('json-store: falls back to defaults when nothing is readable', () => {
  const dir = tmpdir();
  assert.deepEqual(readJSON(path.join(dir, 'missing.json'), { d: 1 }), { data: { d: 1 }, source: 'default' });
  fs.writeFileSync(path.join(dir, 'empty.json'), '   ');
  const r = readJSON(path.join(dir, 'empty.json'), []);
  assert.equal(r.source, 'default');
});

test('json-store: debounced writer coalesces bursts', async () => {
  let n = 0;
  const w = debouncedWriter(() => { n++; }, 20);
  w.schedule(); w.schedule(); w.schedule();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(n, 1);
  w.schedule();
  w.flush();
  assert.equal(n, 2);
  w.flush();
  assert.equal(n, 2, 'flush without pending work does nothing');
});

function fakeSafeStorage({ available = true, backend = 'dpapi' } = {}) {
  return {
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => backend,
    encryptString: (s) => Buffer.from(`ENC:${Buffer.from(s).toString('hex')}`),
    decryptString: (b) => {
      const t = b.toString();
      if (!t.startsWith('ENC:')) throw new Error('bad');
      return Buffer.from(t.slice(4), 'hex').toString();
    },
  };
}

test('vault: encrypts at rest, never writes plaintext, and prunes', () => {
  const dir = tmpdir();
  const file = path.join(dir, 'secrets.json');
  const v = new Vault({ file, safeStorage: fakeSafeStorage(), log: silent });
  v.load();
  assert.deepEqual(v.set('acc_a', 'SECRET-COOKIE-VALUE'), { persisted: true });
  v.set('acc_b', 'OTHER');
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /SECRET-COOKIE-VALUE/);
  const v2 = new Vault({ file, safeStorage: fakeSafeStorage(), log: silent });
  v2.load();
  assert.equal(v2.get('acc_a'), 'SECRET-COOKIE-VALUE');
  v2.prune(['acc_b']);
  assert.equal(v2.has('acc_a'), false);
  assert.equal(v2.remove('acc_b'), true);
  assert.equal(v2.remove('acc_b'), false);
});

test('vault: without OS encryption, secrets stay in memory only', () => {
  const dir = tmpdir();
  const file = path.join(dir, 'secrets.json');
  const v = new Vault({ file, safeStorage: fakeSafeStorage({ available: true, backend: 'basic_text' }), log: silent });
  v.load();
  assert.equal(v.persistent, false);
  assert.deepEqual(v.set('acc_a', 'PLAINTEXT-SHOULD-NOT-HIT-DISK'), { persisted: false });
  assert.equal(v.get('acc_a'), 'PLAINTEXT-SHOULD-NOT-HIT-DISK');
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /PLAINTEXT/);
});

test('vault: adopts legacy encrypted values only if they decrypt', () => {
  const dir = tmpdir();
  const ss = fakeSafeStorage();
  const v = new Vault({ file: path.join(dir, 's.json'), safeStorage: ss, log: silent });
  v.load();
  assert.equal(v.adoptEncrypted('acc_a', ss.encryptString('X').toString('base64')), true);
  assert.equal(v.get('acc_a'), 'X');
  assert.equal(v.adoptEncrypted('acc_b', Buffer.from('garbage').toString('base64')), false);
  assert.equal(v.has('acc_b'), false);
});
