import { afterEach, describe, expect, it } from 'vitest';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
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
      await rm(folder, { recursive: true, force: true });
    }
  });
});
