// One development command owns the API/WebSocket server and Vite, including shutdown.
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

export async function assertPortAvailable(port) {
  // On macOS, an IPv6 wildcard can coexist with an IPv4 loopback listener.
  // Check both addresses used by localhost rather than assuming dual-stack binding.
  for (const host of ['127.0.0.1', '::1']) {
    const server = net.createServer();
    const listening = await new Promise((resolve, reject) => {
      server.once('error', (error) => {
        if (host === '::1' && ['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code)) return resolve(false);
        reject(new Error(`Port ${port} is already in use or unavailable. Stop the existing server before running npm run dev.`, { cause: error }));
      });
      server.listen({ port, host }, () => resolve(true));
    });
    if (listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function launch(args, options) {
  const child = spawn(process.execPath, args, {
    ...options,
    // A process group lets shutdown include the Node watch-mode subprocess.
    detached: process.platform !== 'win32',
  });
  const done = new Promise((resolve) => {
    child.once('error', (error) => resolve({ code: 1, error }));
    child.once('exit', (code, signal) => resolve({ code: code ?? 1, signal }));
  });
  return { child, done };
}

async function stop({ child, done }) {
  if (!child.pid) return;
  const kill = (signal) => {
    try {
      if (process.platform === 'win32') child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  kill('SIGTERM');
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(false), 2000); });
  const exited = await Promise.race([done.then(() => true), timeout]);
  clearTimeout(timer);
  if (!exited) {
    kill('SIGKILL');
    await done;
  }
}

async function waitForBackend(port, signal) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && !signal.aborted) {
    const listening = await new Promise((resolve) => {
      const socket = net.connect({ host: '127.0.0.1', port });
      const finish = (ready) => { socket.destroy(); resolve(ready); };
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
      socket.setTimeout(500, () => finish(false));
    });
    if (listening) return;
    await delay(100);
  }
  if (!signal.aborted) throw new Error(`The backend did not start on port ${port} within 15 seconds.`);
}

export async function runDev({
  cwd = ROOT,
  backendPort = 8080,
  frontendPort = 3000,
  backendArgs = ['--env-file-if-exists=.env', '--watch', 'server/index.js'],
  frontendArgs = ['node_modules/vite/bin/vite.js'],
  env = process.env,
  stdio = ['ignore', 'inherit', 'inherit'],
  signal = new AbortController().signal,
} = {}) {
  await assertPortAvailable(backendPort);
  await assertPortAvailable(frontendPort);
  if (signal.aborted) return 0;
  const controller = new AbortController();
  const aborted = new Promise((resolve) => {
    controller.signal.addEventListener('abort', () => resolve({ code: 0 }), { once: true });
  });
  const onAbort = () => controller.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  const children = [];
  try {
    // Keep this consistent with vite.config.js even if a shell or .env sets PORT.
    const backend = launch(backendArgs, { cwd, env: { ...env, PORT: String(backendPort) }, stdio });
    children.push(backend);
    const ready = await Promise.race([
      waitForBackend(backendPort, controller.signal).then(() => null),
      backend.done,
      aborted,
    ]);
    if (ready) {
      if (ready.error) throw ready.error;
      return ready.code || (signal.aborted ? 0 : 1);
    }
    if (signal.aborted) return 0;
    const frontend = launch(frontendArgs, { cwd, env, stdio });
    children.push(frontend);
    const result = await Promise.race([backend.done, frontend.done, aborted]);
    if (result.error) throw result.error;
    return result.code;
  } finally {
    controller.abort();
    signal.removeEventListener('abort', onAbort);
    await Promise.all(children.map(stop));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (Number(process.versions.node.split('.')[0]) < 24) {
    console.error('Development uses Node 24, matching production. Run nvm install && nvm use, then npm run dev.');
    process.exitCode = 1;
  } else {
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
      console.log('Starting backend :8080 and Vite :3000. Ctrl+C stops both.');
      process.exitCode = await runDev({ signal: controller.signal });
    } catch (error) {
      console.error(`Development startup stopped: ${error.message}`);
      process.exitCode = 1;
    } finally {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
    }
  }
}
