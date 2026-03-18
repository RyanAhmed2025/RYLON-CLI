// modules/runex-env/runner.js
// All shell execution isolated here — nothing else calls child_process directly.

import { execSync, spawnSync } from 'child_process';
import { existsSync } from 'fs';

// ─── run a command synchronously, return { ok, out, err } ────────────────────
export function run(cmd, opts = {}) {
  const { cwd, env } = opts;
  try {
    const out = execSync(cmd, {
      cwd,
      env: { ...process.env, ...env },
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { ok: true, out: out.trim() };
  } catch(e) {
    const err = (e.stderr ?? e.stdout ?? e.message ?? String(e)).trim();
    return { ok: false, out: '', err };
  }
}

// ─── run with the py launcher (preferred on Windows) ─────────────────────────
export function runPy(version, args, opts = {}) {
  const verFlag = version ? [`-${version}`] : [];
  const r = spawnSync('py', [...verFlag, ...args], {
    cwd: opts.cwd,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (r.error) return { ok: false, out: '', err: r.error.message };
  const out = (r.stdout ?? '').trim();
  const err = (r.stderr ?? '').trim();
  return { ok: r.status === 0, out, err };
}

// ─── run pip inside a specific venv ──────────────────────────────────────────
export function runPip(venvPath, pipArgs, opts = {}) {
  const pip = `"${venvPath}\\Scripts\\pip.exe"`;
  return run(`${pip} ${pipArgs.join(' ')}`, opts);
}

// ─── run python inside a specific venv ───────────────────────────────────────
export function runVenvPython(venvPath, pyArgs, opts = {}) {
  const py = `"${venvPath}\\Scripts\\python.exe"`;
  return run(`${py} ${pyArgs.join(' ')}`, opts);
}

// ─── check if a venv exists at path ──────────────────────────────────────────
export function venvExists(dirPath) {
  return existsSync(`${dirPath}\\.venv\\Scripts\\python.exe`) ||
         existsSync(`${dirPath}\\.venv\\bin\\python`);
}

// ─── resolve venv python path ─────────────────────────────────────────────────
export function venvPythonPath(projectPath) {
  const win = `${projectPath}\\.venv\\Scripts\\python.exe`;
  const nix = `${projectPath}\\.venv\\bin\\python`;
  if (existsSync(win)) return win;
  if (existsSync(nix)) return nix;
  return null;
}

// ─── check if winget is available ────────────────────────────────────────────
export function hasWinget() {
  const r = run('winget --version');
  return r.ok;
}

// ─── check if py launcher is available ───────────────────────────────────────
export function hasPyLauncher() {
  const r = run('py --version');
  return r.ok;
}

// ─── parse pip list output into array of { name, version } ───────────────────
export function parsePipList(raw) {
  return raw
    .split('\n')
    .slice(2) // skip header rows
    .map(line => {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2) return null;
      return { name: parts[0], version: parts[1] };
    })
    .filter(Boolean);
}

// ─── parse py --list output into array of { version, path } ─────────────────
export function parsePyList(raw) {
  return raw
    .split('\n')
    .map(line => line.trim())
    .filter(l => l.startsWith('-'))
    .map(line => {
      // format: -V:3.12 *  Python 3.12.4 (C:\...)
      const m = line.match(/-V:([\d.]+)\s+\*?\s+Python\s+([\d.]+)/);
      if (!m) return null;
      return { version: m[2], key: m[1] };
    })
    .filter(Boolean);
}
