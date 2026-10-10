// Thin wrapper over the preload bridge. Main returns { ok, data } or
// { ok: false, error: { code, ... } }; failures become AppError.

export class AppError extends Error {
  constructor(info) {
    super(info.code || 'INTERNAL_ERROR');
    this.code = info.code || 'INTERNAL_ERROR';
    Object.assign(this, info);
  }
}

export async function call(channel, ...args) {
  const res = await window.ram.invoke(channel, ...args);
  if (res && res.ok) return res.data;
  throw new AppError((res && res.error) || { code: 'INTERNAL_ERROR' });
}

export function on(event, cb) {
  return window.ram.on(event, cb);
}
