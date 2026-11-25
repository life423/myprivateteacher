import { afterEach, describe, expect, it } from 'vitest';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertPortAvailable, runDev } from './dev.mjs';

const active = [];
afterEach(async () => {
  for (const { controller, run } of active.splice(0)) {
    controller.abort();
    await run;
  }
});

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function probe(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const finish = (value) => { socket.destroy(); resolve(value); };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(100, () => finish(false));
  });
}

async function waitUntilListening(port) {
  for (let n = 0; n < 100; n++) {
    if (await probe(port)) return;
    await delay(25);
  }
  throw new Error(`Test server did not listen on ${port}`);
}

async function removeWatchFixture(folder) {
  const resolved = path.resolve(folder);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('mpt-dev-watch-test-')) {
    throw new Error(`Refusing to remove a path outside the watch fixture directory: ${resolved}`);
  }
  await rm(resolved, { recursive: true, force: true });
}

async function waitForBackendValue(port, check) {
  for (let n = 0; n < 100; n++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}`);
      const value = await response.json();
      if (check(value)) return value;
    } catch {
      // The watched child briefly closes the socket while restarting.
    }
    await delay(25);
  }
  throw new Error('The watched backend did not return the expected source version.');
}

const serverArgs = (port, extra = '') => ['-e', `require('node:net').createServer().listen(${port},'127.0.0.1');${extra}`];
function start(options) {
  const controller = new AbortController();
  const run = runDev({ stdio: 'ignore', ...options, signal: controller.signal });
  active.push({ controller, run });
  return { controller, run };
}

describe('combined development startup', () => {
  it('rejects a busy port before starting either application', async () => {
    const server = net.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      await expect(assertPortAvailable(server.address().port)).rejects.toThrow(/already in use/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('starts both servers and stops them together', async () => {
    const backendPort = await unusedPort();
    const frontendPort = await unusedPort();
    const { controller, run } = start({ backendPort, frontendPort,
      backendArgs: serverArgs(backendPort), frontendArgs: serverArgs(frontendPort) });
    await waitUntilListening(frontendPort);
    expect(await probe(backendPort)).toBe(true);
    controller.abort();
    expect(await run).toBe(0);
    expect(await probe(backendPort)).toBe(false);
    expect(await probe(frontendPort)).toBe(false);
  });

  it('rejects an occupied frontend port without starting the backend', async () => {
    const backendPort = await unusedPort();
    const server = net.createServer();
    await new Promise((resolve) => server.listen(0, '::1', resolve));
    const frontendPort = server.address().port;
    try {
      await expect(runDev({ backendPort, frontendPort, stdio: 'ignore',
        backendArgs: serverArgs(backendPort), frontendArgs: serverArgs(frontendPort) })).rejects.toThrow(`Port ${frontendPort}`);
      expect(await probe(backendPort)).toBe(false);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('propagates a frontend failure and stops the backend', async () => {
    const backendPort = await unusedPort();
    const frontendPort = await unusedPort();
    const { run } = start({ backendPort, frontendPort,
      backendArgs: serverArgs(backendPort), frontendArgs: ['-e', 'process.exit(7)'] });
    expect(await run).toBe(7);
    expect(await probe(backendPort)).toBe(false);
    expect(await probe(frontendPort)).toBe(false);
  });

  it('does not start Vite if the backend exits during startup', async () => {
    const backendPort = await unusedPort();
    const frontendPort = await unusedPort();
    const { run } = start({ backendPort, frontendPort,
      backendArgs: ['-e', 'process.exit(4)'], frontendArgs: serverArgs(frontendPort) });
    expect(await run).toBe(4);
    expect(await probe(backendPort)).toBe(false);
    expect(await probe(frontendPort)).toBe(false);
  });

  it('stops Vite when a running backend fails', async () => {
    const backendPort = await unusedPort();
    const frontendPort = await unusedPort();
    const { run } = start({ backendPort, frontendPort,
      backendArgs: serverArgs(backendPort, 'setTimeout(() => process.exit(6), 500);'),
      frontendArgs: serverArgs(frontendPort) });
    await waitUntilListening(frontendPort);
    expect(await run).toBe(6);
    expect(await probe(backendPort)).toBe(false);
    expect(await probe(frontendPort)).toBe(false);
  });

  it('also stops the real Node watch-mode subprocess', async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), 'mpt-dev-watch-test-'));
    const filename = path.join(folder, 'backend.cjs');
    const backendPort = await unusedPort();
    const frontendPort = await unusedPort();
    await writeFile(filename, `require('node:net').createServer().listen(${backendPort},'127.0.0.1');`);
    const { controller, run } = start({ backendPort, frontendPort,
      backendArgs: ['--watch', filename], frontendArgs: serverArgs(frontendPort) });
    try {
      await waitUntilListening(frontendPort);
      controller.abort();
      expect(await run).toBe(0);
      expect(await probe(backendPort)).toBe(false);
      expect(await probe(frontendPort)).toBe(false);
    } finally {
      controller.abort();
      await run;
      await removeWatchFixture(folder);
    }
  });

  it('starts the default watched backend without an optional local environment file', async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), 'mpt-dev-watch-test-'));
    const backendPort = await unusedPort();
    const frontendPort = await unusedPort();
    await Promise.all([
      mkdir(path.join(folder, 'server'), { recursive: true }),
      mkdir(path.join(folder, 'shared'), { recursive: true }),
    ]);
    await writeFile(path.join(folder, 'server', 'index.js'), "require('node:net').createServer().listen(process.env.PORT, '127.0.0.1');");
    const { controller, run } = start({ cwd: folder, backendPort, frontendPort, frontendArgs: serverArgs(frontendPort) });
    try {
      await waitUntilListening(frontendPort);
      expect(await probe(backendPort)).toBe(true);
      controller.abort();
      expect(await run).toBe(0);
      expect(await probe(backendPort)).toBe(false);
      expect(await probe(frontendPort)).toBe(false);
    } finally {
      controller.abort();
      await run;
      await removeWatchFixture(folder);
    }
  });

  it.skipIf(!['win32', 'darwin'].includes(process.platform))('keeps dependencies out of default watch while reloading server and shared source', async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), 'mpt-dev-watch-test-'));
    const backendPort = await unusedPort();
    const frontendPort = await unusedPort();
    const serverFile = path.join(folder, 'server', 'index.js');
    const sharedFile = path.join(folder, 'shared', 'value.cjs');
    const dependencyFile = path.join(folder, 'node_modules', 'fixture-dependency', 'index.cjs');
    await Promise.all([
      mkdir(path.dirname(serverFile), { recursive: true }),
      mkdir(path.dirname(sharedFile), { recursive: true }),
      mkdir(path.dirname(dependencyFile), { recursive: true }),
    ]);
    const serverSource = (version) => `
      const shared = require('../shared/value.cjs');
      const dependency = require('../node_modules/fixture-dependency/index.cjs');
      require('node:http').createServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ pid: process.pid, server: '${version}', shared, dependency,
          localValue: process.env.MPT_WATCH_FIXTURE_LOCAL, explicitValue: process.env.MPT_WATCH_FIXTURE_EXPLICIT }));
      }).listen(process.env.PORT, '127.0.0.1');
    `;
    await Promise.all([
      writeFile(serverFile, serverSource('first')),
      writeFile(sharedFile, "module.exports = 'first';"),
      writeFile(dependencyFile, "module.exports = 'first';"),
      writeFile(path.join(folder, '.env'), 'MPT_WATCH_FIXTURE_LOCAL=from-file\nMPT_WATCH_FIXTURE_EXPLICIT=from-file\n'),
    ]);
    const { controller, run } = start({ cwd: folder, backendPort, frontendPort,
      env: { ...process.env, MPT_WATCH_FIXTURE_EXPLICIT: 'from-environment' }, frontendArgs: serverArgs(frontendPort) });
    try {
      await waitUntilListening(frontendPort);
      const first = await waitForBackendValue(backendPort, value => value.server === 'first');
      expect(first.localValue).toBe('from-file');
      expect(first.explicitValue).toBe('from-environment');
      await writeFile(dependencyFile, "module.exports = 'changed';");
      // Node's watch debounce is 200ms. Let dependency notifications settle,
      // then verify the original child still serves its unchanged module.
      await delay(1000);
      const unchanged = await waitForBackendValue(backendPort, () => true);
      expect(unchanged).toEqual(first);

      await writeFile(sharedFile, "module.exports = 'changed';");
      const sharedReloaded = await waitForBackendValue(backendPort, value => value.shared === 'changed');
      expect(sharedReloaded.pid).not.toBe(first.pid);
      expect(sharedReloaded.dependency).toBe('changed');

      await writeFile(serverFile, serverSource('changed'));
      const serverReloaded = await waitForBackendValue(backendPort, value => value.server === 'changed');
      expect(serverReloaded.pid).not.toBe(sharedReloaded.pid);
      expect(await probe(frontendPort)).toBe(true);

      controller.abort();
      expect(await run).toBe(0);
      expect(await probe(backendPort)).toBe(false);
      expect(await probe(frontendPort)).toBe(false);
    } finally {
      controller.abort();
      await run;
      await removeWatchFixture(folder);
    }
  }, 15000);
});
