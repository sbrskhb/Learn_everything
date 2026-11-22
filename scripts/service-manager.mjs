import fs from 'fs';
import net from 'net';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const RUNTIME_DIR = path.join(DATA_DIR, 'runtime');
const STATE_FILE = path.join(RUNTIME_DIR, 'service.json');
const LOGS_DIR = path.join(DATA_DIR, 'logs');
const LOG_FILE = path.join(LOGS_DIR, 'server.log');
const PREV_LOG_FILE = path.join(LOGS_DIR, 'server.prev.log');
const BUILD_LOG_FILE = path.join(LOGS_DIR, 'build.log');

const MAX_LOG_BYTES = 2 * 1024 * 1024;

function normalizeWinPath(p) {
  return String(p || '').replace(/\\/g, '/').toLowerCase();
}

function readSettingsPorts() {
  let port = Number(process.env.PORT) || 0;
  if (!port) {
    try {
      const settingsPath = path.join(DATA_DIR, 'settings.json');
      if (fs.existsSync(settingsPath)) {
        const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        const candidate = Number(raw?.serverPort);
        if (Number.isInteger(candidate) && candidate >= 1024 && candidate <= 65535) {
          port = candidate;
        }
      }
    } catch {
      // ignore invalid settings.json
    }
  }
  if (!port) port = 3000;
  const pyPort = Number(process.env.PYTHON_BACKEND_PORT) || 3001;
  return { port, pyPort };
}

function readServiceState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    return raw && typeof raw === 'object' ? raw : null;
  } catch {
    return null;
  }
}

function writeServiceState(state) {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

function removeServiceState() {
  try {
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
  } catch {
    // ignore
  }
}

function getLatestMtimeMs(targets) {
  let maxMtime = 0;
  const walk = (target) => {
    if (!fs.existsSync(target)) return;
    const st = fs.statSync(target);
    if (st.mtimeMs > maxMtime) maxMtime = st.mtimeMs;
    if (st.isDirectory()) {
      for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '__pycache__') {
          continue;
        }
        walk(path.join(target, entry.name));
      }
    }
  };
  for (const rel of targets) {
    walk(path.isAbsolute(rel) ? rel : path.join(ROOT_DIR, rel));
  }
  return maxMtime;
}

function rotateLogIfNeeded() {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > MAX_LOG_BYTES) {
      if (fs.existsSync(PREV_LOG_FILE)) {
        fs.unlinkSync(PREV_LOG_FILE);
      }
      fs.renameSync(LOG_FILE, PREV_LOG_FILE);
    }
  } catch {
    // ignore log rotation error
  }
}

function canBindPort(port, host) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    srv.once('error', () => done(false));
    srv.once('listening', () => {
      srv.close(() => done(true));
    });
    try {
      srv.listen({ port, host, exclusive: true });
    } catch {
      done(false);
    }
  });
}

async function isPortAvailable(port, checkWildcard = true) {
  const loopOk = await canBindPort(port, '127.0.0.1');
  if (!loopOk) return false;
  if (checkWildcard) {
    const anyOk = await canBindPort(port, '0.0.0.0');
    if (!anyOk) return false;
  }
  return true;
}

async function pickAvailablePort(preferredPort, excludePorts = new Set(), checkWildcard = true) {
  for (let offset = 0; offset <= 30; offset++) {
    const candidate = preferredPort + offset;
    if (candidate > 65535 || excludePorts.has(candidate)) continue;
    if (await isPortAvailable(candidate, checkWildcard)) {
      return candidate;
    }
  }
  throw new Error(`未找到从 ${preferredPort} 开始的可用空闲端口`);
}

async function fetchJsonWithTimeout(url, timeoutMs = 2000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBothHealth(port, pyPort) {
  const [stateRes, pyProxyRes, pyDirectRes] = await Promise.all([
    fetchJsonWithTimeout(`http://127.0.0.1:${port}/api/state`, 2000),
    fetchJsonWithTimeout(`http://127.0.0.1:${port}/api/backend/health`, 2000),
    fetchJsonWithTimeout(`http://127.0.0.1:${pyPort}/api/py/health`, 1500),
  ]);
  const nodeHealthy = stateRes.ok && Boolean(stateRes.data && Array.isArray(stateRes.data.courses));
  const pythonHealthy =
    (pyProxyRes.ok && Boolean(pyProxyRes.data?.ok)) ||
    (pyDirectRes.ok && Boolean(pyDirectRes.data?.ok));
  return {
    nodeHealthy,
    pythonHealthy,
    healthy: nodeHealthy && pythonHealthy,
    nodePid: pyProxyRes.data?.nodePid ?? null,
    pythonPid: pyProxyRes.data?.pythonPid ?? pyDirectRes.data?.pid ?? null,
  };
}

function isProcessAlive(pid) {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killPidTree(pid) {
  if (!pid || !Number.isInteger(pid) || pid <= 0 || pid === process.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], {
      windowsHide: true,
      stdio: 'ignore',
    });
  } else {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // ignore
    }
  }
}

function findWorkspaceProcessPidsWin32(ports) {
  if (process.platform !== 'win32') return [];
  const normRoot = normalizeWinPath(ROOT_DIR);
  const uniquePorts = Array.from(
    new Set((ports || []).filter((n) => Number.isInteger(n) && n > 0 && n <= 65535))
  );
  const portsLiteral = uniquePorts.length > 0 ? uniquePorts.join(',') : '3000,3001';

  const psScript = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    '$all = Get-CimInstance Win32_Process',
    '$byId = @{}',
    'foreach ($p in $all) { $byId[[int]$p.ProcessId] = $p }',
    "$ancestors = New-Object 'System.Collections.Generic.HashSet[int]'",
    `$cur = ${process.pid}`,
    'for ($i = 0; $i -lt 16 -and $cur -gt 0; $i++) {',
    '  [void]$ancestors.Add($cur)',
    '  if ($byId.ContainsKey($cur)) { $cur = [int]$byId[$cur].ParentProcessId } else { break }',
    '}',
    `$listenPids = @(Get-NetTCPConnection -LocalPort ${portsLiteral} -State Listen | Select-Object -ExpandProperty OwningProcess -Unique)`,
    '$foundPids = @()',
    'foreach ($p in $all) {',
    '  $pidInt = [int]$p.ProcessId',
    '  if ($ancestors.Contains($pidInt)) { continue }',
    "  $cmd = ([string]$p.CommandLine).Replace('\\', '/').ToLowerInvariant()",
    '  if (-not $cmd) { continue }',
    `  $inWorkspace = $cmd.Contains('${normRoot.replace(/'/g, "''")}')`,
    '  $isListeningTarget = $listenPids -contains $pidInt',
    "  $isServer = ($cmd -match 'server\\.ts') -or ($cmd -match 'backend/server\\.py')",
    "  $isLegacyBatch = ($p.Name -ieq 'cmd.exe') -and $inWorkspace -and ($cmd -match 'start\\.bat')",
    '  if (($isServer -and ($inWorkspace -or $isListeningTarget)) -or $isLegacyBatch) {',
    '    $foundPids += $pidInt',
    '  }',
    '}',
    "$foundPids -join ','",
  ].join('\n');

  const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
  const res = spawnSync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
    {
      cwd: ROOT_DIR,
      windowsHide: true,
      encoding: 'utf-8',
      timeout: 8000,
    }
  );
  if (res.status !== 0 || !res.stdout) return [];
  return res.stdout
    .split(/[,\s]+/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0 && n !== process.pid);
}

async function stopServices(silent = false) {
  const { port, pyPort } = readSettingsPorts();
  const state = readServiceState();
  const portsToCheck = [port, pyPort];
  if (state?.port) portsToCheck.push(state.port);
  if (state?.pyPort) portsToCheck.push(state.pyPort);

  const pidsToStop = new Set();
  if (state?.nodePid && Number.isInteger(state.nodePid)) pidsToStop.add(state.nodePid);
  if (state?.pythonPid && Number.isInteger(state.pythonPid)) pidsToStop.add(state.pythonPid);

  if (process.platform === 'win32') {
    for (const pid of findWorkspaceProcessPidsWin32(portsToCheck)) {
      pidsToStop.add(pid);
    }
  }

  for (const pid of pidsToStop) {
    if (isProcessAlive(pid)) {
      killPidTree(pid);
    }
  }

  // Wait up to 5 seconds specifically for our workspace PIDs to exit
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const anyAlive = Array.from(pidsToStop).some((pid) => isProcessAlive(pid));
    if (!anyAlive) break;
    await new Promise((r) => setTimeout(r, 150));
  }

  removeServiceState();
  if (!silent) {
    console.log('[Learn_everything] 后台服务已停止。');
  }
}

function ensureFrontendBuilt(silent = false) {
  const distIndex = path.join(ROOT_DIR, 'dist', 'index.html');
  const latestFrontendMtime = getLatestMtimeMs([
    'src',
    'index.html',
    'package.json',
    'vite.config.ts',
    'tsconfig.json',
  ]);
  const distExists = fs.existsSync(distIndex);
  const distMtime = distExists ? fs.statSync(distIndex).mtimeMs : 0;

  if (distExists && distMtime >= latestFrontendMtime) {
    return;
  }

  if (!silent) {
    console.log('[Learn_everything] 检测到前端资源需要更新，正在静默构建 dist/ ...');
  }

  const viteCli = path.join(ROOT_DIR, 'node_modules', 'vite', 'bin', 'vite.js');
  const buildRes = fs.existsSync(viteCli)
    ? spawnSync(process.execPath, [viteCli, 'build'], {
        cwd: ROOT_DIR,
        windowsHide: true,
        encoding: 'utf-8',
      })
    : spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
        cwd: ROOT_DIR,
        shell: process.platform === 'win32',
        windowsHide: true,
        encoding: 'utf-8',
      });

  if (buildRes.status !== 0) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    fs.writeFileSync(
      BUILD_LOG_FILE,
      `[${new Date().toISOString()}] build failed (code=${buildRes.status})\n${buildRes.stdout || ''}\n${buildRes.stderr || ''}`,
      'utf-8'
    );
    throw new Error(`前端构建失败，详情请查看 ${BUILD_LOG_FILE}`);
  }
}

function openBrowserUrl(url) {
  if (process.platform === 'win32') {
    const child = spawn('explorer.exe', [url], {
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
    });
    child.unref();
    return;
  }
  const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
  const child = spawn(cmd, [url], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

async function startServices({
  forceRestart = false,
  noOpen = false,
  silent = false,
  foreground = false,
} = {}) {
  const { port: configuredPort, pyPort: configuredPyPort } = readSettingsPorts();

  if (!fs.existsSync(path.join(ROOT_DIR, 'node_modules', 'express'))) {
    throw new Error('缺少依赖 node_modules，请先运行一次 start.bat 安装依赖。');
  }

  ensureFrontendBuilt(silent);

  const existingState = readServiceState();
  const activePort = existingState?.port || configuredPort;
  const activePyPort = existingState?.pyPort || configuredPyPort;
  const currentHealth = await fetchBothHealth(activePort, activePyPort);

  const latestBackendMtime = getLatestMtimeMs([
    'server.ts',
    'backend/server.py',
    'src/types.ts',
    'src/prompts',
    'src/utils',
    'learn-everything-prompts',
  ]);
  const startedAtMs = existingState?.startedAt ? Date.parse(existingState.startedAt) : 0;
  const distMtime = fs.existsSync(path.join(ROOT_DIR, 'dist', 'index.html'))
    ? fs.statSync(path.join(ROOT_DIR, 'dist', 'index.html')).mtimeMs
    : 0;

  const canReuseRunning =
    !forceRestart &&
    !foreground &&
    currentHealth.healthy &&
    Boolean(currentHealth.nodePid) &&
    Boolean(existingState) &&
    startedAtMs >= latestBackendMtime &&
    startedAtMs >= distMtime;

  if (canReuseRunning) {
    const reuseUrl = `http://localhost:${activePort}`;
    if (!silent) {
      console.log(`[Learn_everything] 后台服务已在运行中 (${reuseUrl})，直接复用。`);
    }
    if (!noOpen) {
      openBrowserUrl(reuseUrl);
    }
    return;
  }

  if (!silent && (currentHealth.nodeHealthy || currentHealth.pythonHealthy || existingState)) {
    console.log('[Learn_everything] 正在清理旧实例并启动最新的后台聚合服务...');
  }
  await stopServices(true);

  const chosenPort = await pickAvailablePort(configuredPort, new Set([configuredPyPort]), true);
  const chosenPyPort = await pickAvailablePort(configuredPyPort, new Set([chosenPort]), false);
  const appUrl = `http://localhost:${chosenPort}`;

  if (chosenPort !== configuredPort && !silent) {
    console.log(
      `[Learn_everything] 端口 ${configuredPort} 已被其他程序占用，已自动切换至空闲端口 ${chosenPort} (${appUrl})。`
    );
  }

  const spawnEnv = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(chosenPort),
    PYTHON_BACKEND_PORT: String(chosenPyPort),
    PYTHON_BACKEND_URL: `http://127.0.0.1:${chosenPyPort}`,
    LEARN_EVERYTHING_ROOT: ROOT_DIR,
    PYTHONIOENCODING: 'utf-8',
  };

  if (foreground) {
    const fg = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
      cwd: ROOT_DIR,
      env: spawnEnv,
      stdio: 'inherit',
    });
    fg.on('exit', (code) => process.exit(code ?? 0));
    return;
  }

  rotateLogIfNeeded();
  const logFd = fs.openSync(LOG_FILE, 'a');
  try {
    fs.writeSync(
      logFd,
      `\n=== [${new Date().toISOString()}] Starting unified Learn_everything background service (port=${chosenPort}, pyPort=${chosenPyPort}) ===\n`
    );
  } catch {
    // ignore log header write failure
  }

  const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: ROOT_DIR,
    env: spawnEnv,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();
  fs.closeSync(logFd);

  // Wait up to 25 seconds for unified Node + Python backends to respond
  let readyHealth = null;
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    const h = await fetchBothHealth(chosenPort, chosenPyPort);
    if (h.healthy) {
      readyHealth = h;
      break;
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  if (!readyHealth) {
    throw new Error(`后台服务启动超时，请检查日志：${LOG_FILE}`);
  }

  writeServiceState({
    nodePid: readyHealth.nodePid || child.pid,
    pythonPid: readyHealth.pythonPid,
    port: chosenPort,
    pyPort: chosenPyPort,
    configuredPort,
    startedAt: new Date().toISOString(),
    rootDir: ROOT_DIR,
    logPath: LOG_FILE,
  });

  if (!silent) {
    console.log(
      `[Learn_everything] 后台聚合服务已启动 (${appUrl}) | Node PID=${readyHealth.nodePid || child.pid}, Python PID=${readyHealth.pythonPid ?? 'n/a'}`
    );
    console.log(`[Learn_everything] 日志文件: ${LOG_FILE}`);
  }

  if (!noOpen) {
    openBrowserUrl(appUrl);
  }
}

async function printStatus() {
  const { port, pyPort } = readSettingsPorts();
  const state = readServiceState();
  const probePort = state?.port || port;
  const probePyPort = state?.pyPort || pyPort;
  const health = await fetchBothHealth(probePort, probePyPort);
  const output = {
    running: health.healthy,
    nodeHealthy: health.nodeHealthy,
    pythonHealthy: health.pythonHealthy,
    url: `http://localhost:${probePort}`,
    port: probePort,
    pyPort: probePyPort,
    nodePid: health.nodePid ?? state?.nodePid ?? null,
    pythonPid: health.pythonPid ?? state?.pythonPid ?? null,
    startedAt: state?.startedAt ?? null,
    logPath: LOG_FILE,
  };
  console.log(JSON.stringify(output, null, 2));
}

async function main() {
  const args = process.argv.slice(2);
  const command = args.find((a) => !a.startsWith('-')) || 'start';
  const flags = new Set(args.filter((a) => a.startsWith('-')));
  const noOpen = flags.has('--no-open');
  const silent = flags.has('--silent');
  const foreground = flags.has('--foreground');
  const forceRestart = flags.has('--restart') || command === 'restart';

  if (command === 'stop') {
    await stopServices(silent);
    return;
  }
  if (command === 'status') {
    await printStatus();
    return;
  }
  if (command === 'start' || command === 'restart') {
    await startServices({ forceRestart, noOpen, silent, foreground });
    return;
  }

  console.error(`Unknown command: ${command}. Usage: start | stop | restart | status`);
  process.exit(1);
}

main().catch((err) => {
  console.error(`[Learn_everything] ${err?.message || err}`);
  process.exit(1);
});
