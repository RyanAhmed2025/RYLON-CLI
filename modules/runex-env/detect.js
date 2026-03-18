// modules/runex-env/detect.js
// Python detection, version parsing, path scanning — read-only, no side effects.

import { existsSync, readdirSync, readFileSync } from 'fs';
import { run, hasPyLauncher, parsePyList } from './runner.js';

// ─── find all Python installs on the system ───────────────────────────────────
export function findAllPythons() {
  const found = [];

  // Method 1: py launcher (most reliable on Windows)
  const pyList = run('py --list-paths');
  if (pyList.ok) {
    const lines = pyList.out.split('\n').filter(l => l.trim().startsWith('-'));
    for (const line of lines) {
      // -V:3.12 *  C:\Python312\python.exe
      const m = line.match(/-V:([\d.]+)\s+\*?\s+(.*python\.exe)/i);
      if (m) {
        found.push({
          version: m[1],
          path:    m[2].trim(),
          source:  'py-launcher',
          active:  line.includes('*'),
        });
      }
    }
  }

  // Method 2: where python (catches PATH entries not in py launcher)
  const whereResult = run('where python');
  if (whereResult.ok) {
    for (const p of whereResult.out.split('\n').map(l => l.trim()).filter(Boolean)) {
      if (!found.some(f => f.path.toLowerCase() === p.toLowerCase())) {
        const ver = getVersionFromExe(p);
        found.push({ version: ver ?? 'unknown', path: p, source: 'PATH', active: false });
      }
    }
  }

  // Method 3: common install locations scan
  const commonRoots = [
    'C:\\Python312', 'C:\\Python311', 'C:\\Python310', 'C:\\Python39', 'C:\\Python38',
    `${process.env.LOCALAPPDATA}\\Programs\\Python`,
    `${process.env.PROGRAMFILES}\\Python`,
    `${process.env.PROGRAMFILES}\\Python312`,
    `${process.env.PROGRAMFILES}\\Python311`,
    `${process.env.PROGRAMFILES}\\Python310`,
  ].filter(Boolean);

  for (const root of commonRoots) {
    if (!existsSync(root)) continue;
    // could be the exe directly or a parent containing PythonXXX folders
    const direct = `${root}\\python.exe`;
    if (existsSync(direct) && !found.some(f => f.path.toLowerCase() === direct.toLowerCase())) {
      const ver = getVersionFromExe(direct);
      found.push({ version: ver ?? 'unknown', path: direct, source: 'scan', active: false });
    }
    // scan subdirectories (e.g. Programs\Python\Python312\)
    try {
      const subs = readdirSync(root, { withFileTypes: true })
        .filter(d => d.isDirectory() && d.name.toLowerCase().startsWith('python'));
      for (const sub of subs) {
        const exe = `${root}\\${sub.name}\\python.exe`;
        if (existsSync(exe) && !found.some(f => f.path.toLowerCase() === exe.toLowerCase())) {
          const ver = getVersionFromExe(exe);
          found.push({ version: ver ?? 'unknown', path: exe, source: 'scan', active: false });
        }
      }
    } catch {}
  }

  return found;
}

// ─── get version string from a specific exe ───────────────────────────────────
export function getVersionFromExe(exePath) {
  const r = run(`"${exePath}" --version`);
  if (!r.ok) return null;
  const m = (r.out || r.err).match(/Python\s+([\d.]+)/i);
  return m ? m[1] : null;
}

// ─── get the currently active python (first in PATH) ─────────────────────────
export function getActivePython() {
  const r = run('python --version');
  if (!r.ok) return null;
  const m = (r.out || r.err).match(/Python\s+([\d.]+)/i);
  const version = m ? m[1] : 'unknown';
  const whereR  = run('where python');
  const path    = whereR.ok ? whereR.out.split('\n')[0].trim() : 'unknown';
  return { version, path };
}

// ─── list all versions available via py launcher ──────────────────────────────
export function getPyLauncherVersions() {
  const r = run('py --list');
  if (!r.ok) return [];
  return parsePyList(r.out);
}

// ─── check if a specific version is available ────────────────────────────────
export function hasVersion(version) {
  // try py launcher first
  const r = run(`py -${version} --version`);
  if (r.ok) return true;
  // fallback: check known paths
  return findAllPythons().some(p =>
    p.version.startsWith(version.replace(/^3\./, '3.'))
  );
}

// ─── detect what environment files exist in a project dir ────────────────────
export function detectProjectFiles(dirPath) {
  const files = [
    'requirements.txt',
    'requirements-dev.txt',
    'pyproject.toml',
    'Pipfile',
    'Pipfile.lock',
    'setup.py',
    'setup.cfg',
    '.python-version',
    '.env',
    'main.py',
    'app.py',
    'README.md',
    '.gitignore',
  ];
  return files.reduce((acc, f) => {
    acc[f] = existsSync(`${dirPath}\\${f}`);
    return acc;
  }, {});
}

// ─── detect venv info in a project dir ───────────────────────────────────────
export function detectVenv(dirPath) {
  const venvNames = ['.venv', 'venv', 'env', '.env'];
  for (const name of venvNames) {
    const pyWin = `${dirPath}\\${name}\\Scripts\\python.exe`;
    const pyNix = `${dirPath}\\${name}\\bin\\python`;
    if (existsSync(pyWin)) return { found: true, name, path: `${dirPath}\\${name}`, pyExe: pyWin };
    if (existsSync(pyNix)) return { found: true, name, path: `${dirPath}\\${name}`, pyExe: pyNix };
  }
  return { found: false };
}

// ─── detect .python-version file ─────────────────────────────────────────────
export function detectPythonVersionFile(dirPath) {
  const p = `${dirPath}\\.python-version`;
  if (!existsSync(p)) return null;
  try {
    return readFileSync(p, 'utf8').trim();
  } catch { return null; }
}

// ─── get pip list for a venv ──────────────────────────────────────────────────
export function getInstalledPackages(venvPath) {
  const pip = `"${venvPath}\\Scripts\\pip.exe"`;
  const r   = run(`${pip} list --format=columns`);
  if (!r.ok) return [];
  return r.out
    .split('\n').slice(2)
    .map(line => { const p = line.trim().split(/\s+/); return p.length >= 2 ? { name:p[0], version:p[1] } : null; })
    .filter(Boolean);
}