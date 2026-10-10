'use strict';

// Runs the Electron end-to-end tests. On Linux without a display it re-runs
// itself inside xvfb-run so the app has a screen to draw on.
const { spawnSync } = require('child_process');
const path = require('path');

const files = process.argv.slice(2).length ? process.argv.slice(2) : [path.join('test', 'e2e', '*.spec.js')];
const needsXvfb = process.platform === 'linux' && !process.env.DISPLAY;
const cmd = needsXvfb ? 'xvfb-run' : process.execPath;
const args = needsXvfb
  ? ['-a', '-s', '-screen 0 1440x900x24', process.execPath, '--test', '--test-concurrency=1', ...files]
  : ['--test', '--test-concurrency=1', ...files];

const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: path.join(__dirname, '..', '..') });
process.exit(r.status === null ? 1 : r.status);
