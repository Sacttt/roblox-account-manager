'use strict';

const crypto = require('crypto');
const { EventEmitter } = require('events');
const { readJSON, writeJSON } = require('./json-store');
const { parseGameTarget } = require('./roblox/launch-uri');
const { cleanText } = require('./accounts-model');

const MAX_PRESETS = 60;
const DEFAULT_PRESETS = [
  { name: 'Brookhaven RP', target: '4924922222' },
  { name: 'Blox Fruits', target: '2753915549' },
  { name: 'Pet Simulator 99', target: '8737899170' },
  { name: 'Da Hood', target: '2788229376' },
];

function normalizePreset(p) {
  if (!p || typeof p !== 'object') return null;
  const name = cleanText(p.name, 40);
  const target = cleanText(p.target, 500);
  if (!name || !target || parseGameTarget(target).error) return null;
  return {
    id: typeof p.id === 'string' && /^[\w-]{1,64}$/.test(p.id) ? p.id : newId(),
    name,
    target,
    lastUsedAt: Number.isFinite(p.lastUsedAt) ? p.lastUsedAt : null,
  };
}

function newId() {
  return `p_${crypto.randomBytes(5).toString('hex')}`;
}

class PresetStore extends EventEmitter {
  constructor({ file, log }) {
    super();
    this.file = file;
    this.log = log;
    const { data, source } = readJSON(file, null);
    if (data === null && source === 'default') {
      this.items = DEFAULT_PRESETS.map((p) => normalizePreset(p));
    } else {
      const list = Array.isArray(data) ? data : (data && Array.isArray(data.presets) ? data.presets : []);
      this.items = list.map(normalizePreset).filter(Boolean).slice(0, MAX_PRESETS);
    }
  }

  list() {
    return this.items.map((p) => ({ ...p }));
  }

  save() {
    try { writeJSON(this.file, this.items); } catch (e) { this.log.error('failed to save presets', e); }
    this.emit('changed', this.list());
  }

  upsert(input) {
    const preset = normalizePreset(input);
    if (!preset) throw new Error('PRESET_INVALID');
    const idx = this.items.findIndex((p) => p.id === preset.id);
    if (idx >= 0) {
      this.items[idx] = { ...this.items[idx], name: preset.name, target: preset.target };
    } else {
      if (this.items.length >= MAX_PRESETS) throw new Error('PRESET_LIMIT');
      this.items.push(preset);
    }
    this.save();
    return preset;
  }

  remove(id) {
    const before = this.items.length;
    this.items = this.items.filter((p) => p.id !== id);
    if (this.items.length !== before) this.save();
    return before !== this.items.length;
  }

  reorder(ids) {
    if (!Array.isArray(ids)) throw new Error('INVALID');
    const byId = new Map(this.items.map((p) => [p.id, p]));
    const next = ids.map((id) => byId.get(id)).filter(Boolean);
    for (const p of this.items) if (!next.includes(p)) next.push(p);
    this.items = next;
    this.save();
  }

  touch(target) {
    const p = this.items.find((x) => x.target === target);
    if (p) { p.lastUsedAt = Date.now(); this.save(); }
  }

  replaceAll(list) {
    this.items = (Array.isArray(list) ? list : []).map(normalizePreset).filter(Boolean).slice(0, MAX_PRESETS);
    this.save();
  }
}

module.exports = { PresetStore, normalizePreset };
