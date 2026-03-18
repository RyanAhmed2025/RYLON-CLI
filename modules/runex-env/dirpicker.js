// modules/runex-env/dirpicker.js
// Generates a single-step wizard option list for a given directory.
// The main app's existing single-select wizard handles navigation —
// this module just rebuilds the options array each time the user moves.

import { readdirSync, existsSync } from 'fs';
import { join, dirname, parse as parsePath } from 'path';

// folders to hide from the picker
const HIDDEN = new Set([
  'node_modules', '$recycle.bin', 'system volume information',
  'windows', 'program files', 'program files (x86)',
  'programdata', 'recovery', 'perflogs',
  '.git', '__pycache__', '.venv', 'venv',
]);

// ─── build option list for a directory ───────────────────────────────────────
// Returns { options, currentPath, canGoUp }
export function buildDirOptions(currentPath) {
  const parsed = parsePath(currentPath);
  const canGoUp = parsed.root.toLowerCase() !== currentPath.toLowerCase();
  const options = [];

  // go-up option
  if (canGoUp) options.push('↑  .. (go up)');

  // subdirectories
  try {
    const entries = readdirSync(currentPath, { withFileTypes: true });
    const dirs = entries
      .filter(e => {
        if (!e.isDirectory()) return false;
        if (e.name.startsWith('.') && e.name !== '.') return false;
        if (HIDDEN.has(e.name.toLowerCase())) return false;
        return true;
      })
      .map(e => e.name)
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

    for (const d of dirs) options.push(`▸  ${d}`);
  } catch {
    options.push('(cannot read directory)');
  }

  // confirm option
  options.push(`✓  Select this folder`);

  return { options, currentPath, canGoUp };
}

// ─── resolve what the user chose ─────────────────────────────────────────────
// Returns: { action: 'up' | 'enter' | 'select', nextPath? }
export function resolveDirChoice(choice, currentPath) {
  if (choice.startsWith('↑')) {
    return { action: 'up', nextPath: dirname(currentPath) };
  }
  if (choice.startsWith('✓')) {
    return { action: 'select', nextPath: currentPath };
  }
  if (choice.startsWith('▸')) {
    const name = choice.replace(/^▸\s+/, '');
    return { action: 'enter', nextPath: join(currentPath, name) };
  }
  return { action: 'select', nextPath: currentPath };
}

// ─── build a dir-picker wizard step ──────────────────────────────────────────
// Returns a wizard step object compatible with the Rylon wizard system.
export function makeDirStep(currentPath, label = 'Choose a folder') {
  const { options } = buildDirOptions(currentPath);
  return {
    id:      `dirpick_${currentPath.replace(/[^a-z0-9]/gi, '_')}`,
    label:   `${label}  ·  ${currentPath}`,
    type:    'single',
    store:   '__dirpick__',
    options,
    // carry the current path so onWizardComplete can resolve the choice
    _currentPath: currentPath,
  };
}

// ─── get Windows drive letters as starting roots ─────────────────────────────
export function getDriveRoots() {
  const drives = [];
  // check A-Z
  for (let i = 67; i <= 90; i++) { // C to Z
    const d = `${String.fromCharCode(i)}:\\`;
    if (existsSync(d)) drives.push(d);
  }
  return drives.length ? drives : ['C:\\'];
}

// ─── build drive selection step (first step) ─────────────────────────────────
export function makeDriveStep() {
  const drives = getDriveRoots();
  return {
    id:    'driveselect',
    label: 'Choose a drive',
    type:  'single',
    store: '__driveselect__',
    options: drives,
    _isDriveStep: true,
  };
}
