// modules/runex-env/index.js

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import {
  run, runPip, runVenvPython,
  venvExists, venvPythonPath,
  hasWinget, hasPyLauncher, parsePipList,
} from './runner.js';

import {
  findAllPythons, getActivePython, getPyLauncherVersions,
  hasVersion, detectProjectFiles, detectVenv, getInstalledPackages,
} from './detect.js';

import {
  makeDriveStep, makeDirStep, resolveDirChoice,
} from './dirpicker.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, 'data.json');

// ─── session + persistent data ────────────────────────────────────────────────
function loadData() {
  if (!existsSync(DATA_PATH)) return { recentProjects: [], knownPythons: [] };
  try { return JSON.parse(readFileSync(DATA_PATH, 'utf8')); } catch { return { recentProjects: [], knownPythons: [] }; }
}
function saveData(d) {
  try { writeFileSync(DATA_PATH, JSON.stringify(d, null, 2)); } catch {}
}

// ─── line helpers ─────────────────────────────────────────────────────────────
const ln  = (type, text, extra = {}) => ({ type, text, ...extra });
const lnH = t => ln('header', t);
const lnS = t => ln('step', t);
const lnP = ()  => ln('pipe', '');
const lnI = (t, s, col) => ln('item', t, { suffix: s, color: col ?? '#ff9500' });
const lnOk= t => ln('ok', t);
const lnEr= t => ln('err', t);
const lnKV= (k, v, kw = 16) => ln('kv', '', { k, v: String(v ?? '—'), kw, kc: '#4a5878' });
const lnPl= t => ln('plain', t);
const lnSec=t => ln('_section', t);
const lnBar =() => ln('_bar', '');
const lnProw=(k,v) => ln('_prow', '', { k, v: String(v ?? '—') });

// ─── wizard makers ────────────────────────────────────────────────────────────
function makeWiz(steps, answers = {}, onComplete) {
  return { steps, stepIdx: 0, answers: { ...answers }, selIdx: 0, onComplete };
}

// ─── available Python versions to offer ───────────────────────────────────────
const KNOWN_VERSIONS = ['3.13', '3.12', '3.11', '3.10', '3.9', '3.8'];

// ═══════════════════════════════════════════════════════════════════════════════
//  handle()
// ═══════════════════════════════════════════════════════════════════════════════
export function handle(args, ctx) {
  const { C } = ctx;
  const sub   = (args[0] ?? '').toLowerCase().trim();
  const rest  = args.slice(1);

  // ── no args — show command surface ─────────────────────────────────────────
  if (!sub) return { action:'PUSH', lines:[
    lnH('RUNEX-ENV  v1.0.0'),
    lnI('new',     'guided new Python project setup',    C.amber),
    lnI('inspect', 'inspect an existing project',        C.amber),
    lnI('python',  'install · switch · remove · list',   C.amber),
    lnI('env',     'create · reinstall · delete · info', C.amber),
    lnI('deps',    'install · uninstall · list · freeze',C.amber),
    lnI('where',   'find all Python installs on system', C.amber),
  ]};

  // ── where ──────────────────────────────────────────────────────────────────
  if (sub === 'where') {
    const all    = findAllPythons();
    const active = getActivePython();
    const lines  = [lnH('PYTHON INSTALLS FOUND')];
    if (!all.length) {
      lines.push(lnEr('No Python installations found'));
      lines.push(lnPl('Run: runex-env python install 3.12'));
      return { action:'PUSH', lines };
    }
    for (const p of all) {
      lines.push(lnI(
        `Python ${p.version}`,
        p.path,
        p.active ? C.mint : C.amber,
      ));
    }
    lnP();
    if (active) {
      lines.push(lnP());
      lines.push(lnOk(`Active: Python ${active.version}  ·  ${active.path}`));
    }
    const pyLauncher = hasPyLauncher();
    lines.push(lnKV('py launcher', pyLauncher ? 'available' : 'not found', 14));
    lines.push(lnKV('winget',      hasWinget() ? 'available' : 'not found', 14));
    return { action:'PUSH', lines };
  }

  // ── new — start new project wizard ─────────────────────────────────────────
  if (sub === 'new') {
    const pyVersions   = getPyLauncherVersions().map(v => v.version);
    const versionOpts  = pyVersions.length
      ? ['System default', ...pyVersions, 'Enter manually']
      : ['System default', ...KNOWN_VERSIONS, 'Enter manually'];

    const steps = [
      { id:'proj_name',  label:'Project name',           type:'input',  store:'projectName' },
      // drive + dir picker injected in onWizardComplete after name step
    ];

    return {
      action: 'WIZARD',
      lines: [
        lnS('New Python project setup'),
        lnP(),
        lnPl('This will create a project folder, virtual environment, and install dependencies.'),
        lnP(),
      ],
      wizard: makeWiz(steps, {
        _versionOpts: versionOpts,
        _flow: 'new',
      }, 'new_name_done'),
    };
  }

  // ── inspect ────────────────────────────────────────────────────────────────
  if (sub === 'inspect') {
    return {
      action: 'WIZARD',
      lines: [
        lnS('Inspect existing Python project'),
        lnP(),
        lnPl('Navigate to your project folder.'),
        lnP(),
      ],
      wizard: makeWiz([makeDriveStep()], { _flow: 'inspect' }, 'dirpick_inspect'),
    };
  }

  // ── python management ──────────────────────────────────────────────────────
  if (sub === 'python') {
    const action = (rest[0] ?? '').toLowerCase();
    const ver    = rest[1] ?? rest[0]; // handle: python 3.12 or python install 3.12

    if (!action || action === 'list') {
      const versions = getPyLauncherVersions();
      const all      = findAllPythons();
      const lines    = [lnH('INSTALLED PYTHON VERSIONS')];
      if (!versions.length && !all.length) {
        lines.push(lnEr('No Python found'));
        lines.push(lnPl('runex-env python install 3.12'));
        return { action:'PUSH', lines };
      }
      const shown = versions.length ? versions : all;
      for (const p of shown) {
        lines.push(lnI(`Python ${p.version}`, p.path ?? '', C.amber));
      }
      lines.push(lnP());
      lines.push(lnPl('runex-env python install <ver>   · switch <ver>   · remove <ver>'));
      return { action:'PUSH', lines };
    }

    if (action === 'install') {
      const targetVer = ver && /^\d/.test(ver) ? ver : null;
      if (!targetVer) return { action:'PUSH', lines:[
        lnEr('Specify a version:  runex-env python install 3.12'),
      ]};
      return {
        action: 'WIZARD',
        lines: [lnS(`Install Python ${targetVer}`), lnP()],
        wizard: makeWiz([
          { id:'confirm_install', label:`Install Python ${targetVer} via winget?`,
            type:'single', store:'confirm',
            options:['Yes, install it', 'Cancel'] },
        ], { _pythonVersion: targetVer }, 'python_install'),
      };
    }

    if (action === 'switch' || action === 'change' || action === 'use') {
      const targetVer = ver && /^\d/.test(ver) ? ver : null;
      if (!targetVer) return { action:'PUSH', lines:[
        lnEr('Specify a version:  runex-env python switch 3.11'),
      ]};
      const avail = hasVersion(targetVer);
      if (!avail) return { action:'PUSH', lines:[
        lnEr(`Python ${targetVer} not found`),
        lnPl(`runex-env python install ${targetVer}`),
      ]};
      const r = run(`py -${targetVer} --version`);
      return { action:'PUSH', lines:[
        lnS(`Switching to Python ${targetVer}`),
        lnP(),
        r.ok
          ? lnOk(`Python ${targetVer} is available via py launcher`)
          : lnEr(`Could not activate Python ${targetVer}: ${r.err ?? ''}`),
        lnPl(`To use in a venv: py -${targetVer} -m venv .venv`),
      ]};
    }

    if (action === 'remove' || action === 'uninstall') {
      const targetVer = ver && /^\d/.test(ver) ? ver : null;
      if (!targetVer) return { action:'PUSH', lines:[
        lnEr('Specify a version:  runex-env python remove 3.10'),
      ]};
      return {
        action: 'WIZARD',
        lines: [lnS(`Remove Python ${targetVer}`), lnP()],
        wizard: makeWiz([
          { id:'confirm_remove', label:`Remove Python ${targetVer}? This cannot be undone.`,
            type:'single', store:'confirm',
            options:['Yes, remove it', 'Cancel'] },
        ], { _pythonVersion: targetVer }, 'python_remove'),
      };
    }

    if (action === 'current') {
      const active = getActivePython();
      if (!active) return { action:'PUSH', lines:[ lnEr('No active Python found in PATH') ]};
      return { action:'PUSH', lines:[
        lnH('ACTIVE PYTHON'),
        lnKV('Version', active.version),
        lnKV('Path',    active.path),
      ]};
    }

    return { action:'PUSH', lines:[
      lnEr(`Unknown python sub-command: "${action}"`),
      lnPl('Commands: list · install <ver> · switch <ver> · remove <ver> · current'),
    ]};
  }

  // ── env management ─────────────────────────────────────────────────────────
  if (sub === 'env') {
    const action = (rest[0] ?? '').toLowerCase();

    if (action === 'create') {
      return {
        action: 'WIZARD',
        lines: [ lnS('Create virtual environment'), lnP() ],
        wizard: makeWiz([makeDriveStep()], { _flow: 'env_create' }, 'dirpick_env_create'),
      };
    }

    if (action === 'info') {
      return {
        action: 'WIZARD',
        lines: [ lnS('Virtual environment info'), lnP() ],
        wizard: makeWiz([makeDriveStep()], { _flow: 'env_info' }, 'dirpick_env_info'),
      };
    }

    if (action === 'reinstall') {
      return {
        action: 'WIZARD',
        lines: [ lnS('Reinstall virtual environment'), lnP() ],
        wizard: makeWiz([makeDriveStep()], { _flow: 'env_reinstall' }, 'dirpick_env_reinstall'),
      };
    }

    if (action === 'delete') {
      return {
        action: 'WIZARD',
        lines: [ lnS('Delete virtual environment'), lnP() ],
        wizard: makeWiz([
          makeDriveStep(),
        ], { _flow: 'env_delete' }, 'dirpick_env_delete'),
      };
    }

    return { action:'PUSH', lines:[
      lnEr(`Unknown env sub-command: "${action}"`),
      lnPl('Commands: create · info · reinstall · delete'),
    ]};
  }

  // ── deps management ────────────────────────────────────────────────────────
  if (sub === 'deps') {
    const action  = (rest[0] ?? '').toLowerCase();
    const target  = rest.slice(1).join(' ').trim();

    if (action === 'list') {
      return {
        action: 'WIZARD',
        lines: [ lnS('List installed packages'), lnP() ],
        wizard: makeWiz([makeDriveStep()], { _flow: 'deps_list' }, 'dirpick_deps_list'),
      };
    }

    if (action === 'install' && target) {
      return {
        action: 'WIZARD',
        lines: [ lnS(`Install: ${target}`), lnP() ],
        wizard: makeWiz([makeDriveStep()], {
          _flow: 'deps_install', _package: target,
        }, 'dirpick_deps_install'),
      };
    }

    if (action === 'uninstall' && target) {
      return {
        action: 'WIZARD',
        lines: [ lnS(`Uninstall: ${target}`), lnP() ],
        wizard: makeWiz([
          { id:'confirm_uninstall', label:`Remove "${target}"?`,
            type:'single', store:'confirm',
            options:['Yes, remove it', 'Cancel'] },
          makeDriveStep(),
        ], { _flow:'deps_uninstall', _package:target }, 'dirpick_deps_uninstall'),
      };
    }

    if (action === 'freeze') {
      return {
        action: 'WIZARD',
        lines: [ lnS('Freeze dependencies to requirements.txt'), lnP() ],
        wizard: makeWiz([makeDriveStep()], { _flow:'deps_freeze' }, 'dirpick_deps_freeze'),
      };
    }

    if (action === 'from' || action === 'update') {
      const file = target || 'requirements.txt';
      return {
        action: 'WIZARD',
        lines: [ lnS(`Install from ${file}`), lnP() ],
        wizard: makeWiz([makeDriveStep()], {
          _flow:'deps_from', _file: file,
        }, 'dirpick_deps_from'),
      };
    }

    if (action === 'update' && target) {
      return {
        action: 'WIZARD',
        lines: [ lnS(`Update ${target}`), lnP() ],
        wizard: makeWiz([makeDriveStep()], {
          _flow:'deps_update', _package: target,
        }, 'dirpick_deps_update'),
      };
    }

    return { action:'PUSH', lines:[
      lnEr(`Unknown deps command`),
      lnPl('Commands: list · install <pkg> · uninstall <pkg> · freeze · from [file] · update <pkg>'),
    ]};
  }

  return { action:'PUSH', lines:[
    lnEr(`Unknown command: "${sub}"`),
    lnPl('Type: runex-env  to see all commands'),
  ]};
}

// ═══════════════════════════════════════════════════════════════════════════════
//  onWizardComplete()
// ═══════════════════════════════════════════════════════════════════════════════
export function onWizardComplete(answers, completionKey, C) {
  const amber = '#ff9500';

  // ── directory picker navigation (shared across all flows) ──────────────────
  if (completionKey?.startsWith('dirpick_') || answers.__dirpick__ || answers.__driveselect__) {

    // drive selected — move into that drive
    if (answers.__driveselect__ && !answers.__dirpick__) {
      const drive    = answers.__driveselect__;
      const nextStep = makeDirStep(drive, 'Choose project folder');
      return {
        followUpWizard: makeWiz([nextStep], { ...answers }, completionKey),
        lines: [],
      };
    }

    // dir step — resolve choice
    if (answers.__dirpick__) {
      const choice   = answers.__dirpick__;
      const step     = answers._lastDirStep; // we'll store this below
      const currPath = answers._currentPath ?? answers.__driveselect__;
      const { action, nextPath } = resolveDirChoice(choice, currPath);

      if (action === 'up' || action === 'enter') {
        const nextStep = makeDirStep(nextPath, 'Choose project folder');
        return {
          followUpWizard: makeWiz(
            [nextStep],
            { ...answers, __dirpick__: undefined, _currentPath: nextPath },
            completionKey,
          ),
          lines: [],
        };
      }

      // action === 'select' — folder chosen, proceed to flow
      const chosenPath = nextPath;
      return handleFlowWithPath(chosenPath, answers, completionKey, C);
    }
  }

  // ── python install confirm ─────────────────────────────────────────────────
  if (completionKey === 'python_install') {
    if (answers.confirm !== 'Yes, install it') return { lines:[ln('plain','Cancelled')] };
    const ver   = answers._pythonVersion;
    const lines = [lnS(`Installing Python ${ver}`), lnP()];
    if (!hasWinget()) {
      lines.push(lnEr('winget not available'));
      lines.push(lnPl(`Download manually: https://www.python.org/downloads/release/python-${ver.replace(/\./g,'')}/`));
      return { lines };
    }
    const pkgId = `Python.Python.${ver.split('.').slice(0,2).join('.')}`;
    lines.push(lnI(`Running: winget install ${pkgId}`, '', amber));
    const r = run(`winget install --id ${pkgId} --silent --accept-package-agreements --accept-source-agreements`);
    if (r.ok) {
      lines.push(lnOk(`Python ${ver} installed`));
      lines.push(lnPl(`Verify: runex-env where`));
    } else {
      lines.push(lnEr(`Install failed: ${r.err ?? r.out}`));
      lines.push(lnPl(`Try manually: winget install ${pkgId}`));
    }
    return { lines };
  }

  // ── python remove confirm ──────────────────────────────────────────────────
  if (completionKey === 'python_remove') {
    if (answers.confirm !== 'Yes, remove it') return { lines:[lnPl('Cancelled')] };
    const ver   = answers._pythonVersion;
    const lines = [lnS(`Removing Python ${ver}`), lnP()];
    const pkgId = `Python.Python.${ver.split('.').slice(0,2).join('.')}`;
    const r     = run(`winget uninstall --id ${pkgId} --silent`);
    lines.push(r.ok ? lnOk(`Python ${ver} removed`) : lnEr(`Remove failed: ${r.err ?? r.out}`));
    return { lines };
  }

  // ── new project: name entered → start dir picker ───────────────────────────
  if (completionKey === 'new_name_done') {
    return {
      followUpWizard: makeWiz(
        [makeDriveStep()],
        { ...answers, _flow:'new' },
        'dirpick_new',
      ),
      lines: [lnPl(`Project name: ${answers.projectName}`), lnP()],
    };
  }

  return { lines:[ lnEr(`Unhandled completion: ${completionKey}`) ] };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  handleFlowWithPath — called once a directory is confirmed
// ═══════════════════════════════════════════════════════════════════════════════
function handleFlowWithPath(chosenPath, answers, completionKey, C) {
  const amber = '#ff9500';
  const flow  = answers._flow ?? completionKey.replace('dirpick_','');

  // ── inspect ────────────────────────────────────────────────────────────────
  if (flow === 'inspect') {
    const files  = detectProjectFiles(chosenPath);
    const venv   = detectVenv(chosenPath);
    const active = getActivePython();
    const pkgs   = venv.found ? getInstalledPackages(venv.path) : [];
    const lines  = [];

    lines.push(ln('_bar2',''));
    lines.push(lnSec('ENVIRONMENT'));
    lines.push(lnProw('Path',      chosenPath));
    lines.push(lnProw('Python',    active ? `${active.version}  (${active.path})` : 'not found'));
    lines.push(lnProw('Virtualenv', venv.found ? `${venv.name}\\  ✓ found` : 'not found'));
    if (venv.found) {
      const venvPy = run(`"${venv.pyExe}" --version`);
      lines.push(lnProw('Venv Python', venvPy.ok ? (venvPy.out || venvPy.err).replace('Python ','') : 'unknown'));
      lines.push(lnProw('Activate',    `${venv.name}\\Scripts\\activate`));
    }

    lines.push(lnBar());
    lines.push(lnSec('PROJECT FILES'));
    const fileNames = Object.keys(files);
    for (const f of fileNames) {
      lines.push(lnProw(f, files[f] ? '✓' : '—'));
    }

    if (venv.found && pkgs.length) {
      lines.push(lnBar());
      lines.push(lnSec(`DEPENDENCIES  (${pkgs.length})`));
      for (const p of pkgs.slice(0, 20)) {
        lines.push(lnProw(p.name, p.version));
      }
      if (pkgs.length > 20) lines.push(lnPl(`  … and ${pkgs.length - 20} more`));
    }

    lines.push(ln('_bar2',''));
    if (!venv.found) {
      lines.push(lnPl('No venv found — run: runex-env env create'));
    }
    return { lines };
  }

  // ── new project: directory chosen → remaining wizard steps ────────────────
  if (flow === 'new') {
    const versionOpts  = answers._versionOpts ?? ['System default','3.12','3.11','3.10','Enter manually'];
    const remainingSteps = [
      { id:'py_ver',    label:'Python version',      type:'single', store:'pythonVersion',   options: versionOpts },
      { id:'venv_name', label:'Virtualenv name',     type:'single', store:'venvName',
        options:['.venv (recommended)', 'venv', 'env', 'Custom name'] },
      { id:'starter',   label:'Create starter files',type:'multi',  store:'starterFiles', max:6,
        options:['requirements.txt','.gitignore','README.md','main.py','.env','src/ folder'] },
      { id:'install_q', label:'Install libraries?',  type:'single', store:'installChoice',
        options:['Yes — enter names now','Yes — from requirements.txt','No'] },
    ];
    return {
      followUpWizard: makeWiz(
        remainingSteps,
        { ...answers, _chosenPath: chosenPath },
        'new_execute',
      ),
      lines: [lnPl(`Location: ${chosenPath}`), lnP()],
    };
  }

  // ── new project: all steps done → execute ─────────────────────────────────
  if (flow === 'new_execute' || completionKey === 'new_execute') {
    return executeNewProject(chosenPath, answers, C);
  }

  // ── env create ────────────────────────────────────────────────────────────
  if (flow === 'env_create') {
    const lines = [lnS('Creating virtual environment'), lnP()];
    if (venvExists(chosenPath)) {
      lines.push(lnEr('.venv already exists in this directory'));
      lines.push(lnPl('Run: runex-env env reinstall  to recreate it'));
      return { lines };
    }
    const r = run(`py -m venv .venv`, { cwd: chosenPath });
    lines.push(r.ok ? lnOk('.venv created') : lnEr(`Failed: ${r.err}`));
    if (r.ok) lines.push(lnPl(`Activate: ${chosenPath}\\.venv\\Scripts\\activate`));
    return { lines };
  }

  // ── env info ──────────────────────────────────────────────────────────────
  if (flow === 'env_info') {
    const venv  = detectVenv(chosenPath);
    const lines = [lnSec('VIRTUALENV INFO')];
    if (!venv.found) {
      lines.push(lnEr('No virtual environment found'));
      lines.push(lnPl('Run: runex-env env create'));
      return { lines };
    }
    const venvPy = run(`"${venv.pyExe}" --version`);
    lines.push(lnProw('Name',     venv.name));
    lines.push(lnProw('Path',     venv.path));
    lines.push(lnProw('Python',   venvPy.ok ? (venvPy.out||venvPy.err).replace('Python ','') : 'unknown'));
    lines.push(lnProw('Activate', `${venv.name}\\Scripts\\activate`));
    return { lines };
  }

  // ── env reinstall ─────────────────────────────────────────────────────────
  if (flow === 'env_reinstall') {
    const venv  = detectVenv(chosenPath);
    const lines = [lnS('Reinstalling virtual environment'), lnP()];
    if (venv.found) {
      lines.push(lnI('Removing existing venv', venv.path, amber));
      run(`rmdir /S /Q "${venv.path}"`, { cwd: chosenPath });
    }
    const r = run(`py -m venv .venv`, { cwd: chosenPath });
    lines.push(r.ok ? lnOk('.venv recreated') : lnEr(`Failed: ${r.err}`));
    if (r.ok) {
      const reqExists = existsSync(`${chosenPath}\\requirements.txt`);
      if (reqExists) {
        lines.push(lnS('Reinstalling from requirements.txt'));
        const rr = run(`"${chosenPath}\\.venv\\Scripts\\pip.exe" install -r requirements.txt`, { cwd: chosenPath });
        lines.push(rr.ok ? lnOk('Dependencies reinstalled') : lnEr(`pip failed: ${rr.err}`));
      }
    }
    return { lines };
  }

  // ── env delete ────────────────────────────────────────────────────────────
  if (flow === 'env_delete') {
    const venv  = detectVenv(chosenPath);
    const lines = [lnS('Deleting virtual environment'), lnP()];
    if (!venv.found) { lines.push(lnEr('No venv found')); return { lines }; }
    run(`rmdir /S /Q "${venv.path}"`);
    lines.push(lnOk(`${venv.name}\\ removed`));
    return { lines };
  }

  // ── deps list ─────────────────────────────────────────────────────────────
  if (flow === 'deps_list') {
    const venv  = detectVenv(chosenPath);
    const lines = [lnH('INSTALLED PACKAGES')];
    if (!venv.found) {
      lines.push(lnEr('No venv found in this directory'));
      lines.push(lnPl('Run: runex-env env create'));
      return { lines };
    }
    const pkgs = getInstalledPackages(venv.path);
    if (!pkgs.length) { lines.push(lnPl('No packages installed')); return { lines }; }
    for (const p of pkgs) lines.push(lnProw(p.name, p.version));
    lines.push(lnBar());
    lines.push(lnOk(`${pkgs.length} packages`));
    return { lines };
  }

  // ── deps install ──────────────────────────────────────────────────────────
  if (flow === 'deps_install') {
    const pkg   = answers._package;
    const venv  = detectVenv(chosenPath);
    const lines = [lnS(`Installing ${pkg}`), lnP()];
    if (!venv.found) { lines.push(lnEr('No venv found — run: runex-env env create')); return { lines }; }
    const r = run(`"${venv.path}\\Scripts\\pip.exe" install ${pkg}`, { cwd: chosenPath });
    lines.push(r.ok ? lnOk(`${pkg} installed`) : lnEr(`Failed: ${r.err}`));
    return { lines };
  }

  // ── deps uninstall ────────────────────────────────────────────────────────
  if (flow === 'deps_uninstall') {
    if (answers.confirm !== 'Yes, remove it') return { lines:[lnPl('Cancelled')] };
    const pkg   = answers._package;
    const venv  = detectVenv(chosenPath);
    const lines = [lnS(`Uninstalling ${pkg}`), lnP()];
    if (!venv.found) { lines.push(lnEr('No venv found')); return { lines }; }
    const r = run(`"${venv.path}\\Scripts\\pip.exe" uninstall -y ${pkg}`, { cwd: chosenPath });
    lines.push(r.ok ? lnOk(`${pkg} removed`) : lnEr(`Failed: ${r.err}`));
    return { lines };
  }

  // ── deps freeze ───────────────────────────────────────────────────────────
  if (flow === 'deps_freeze') {
    const venv  = detectVenv(chosenPath);
    const lines = [lnS('Freezing dependencies'), lnP()];
    if (!venv.found) { lines.push(lnEr('No venv found')); return { lines }; }
    const r = run(`"${venv.path}\\Scripts\\pip.exe" freeze > requirements.txt`, { cwd: chosenPath });
    lines.push(r.ok ? lnOk('requirements.txt written') : lnEr(`Failed: ${r.err}`));
    return { lines };
  }

  // ── deps from file ────────────────────────────────────────────────────────
  if (flow === 'deps_from') {
    const file  = answers._file ?? 'requirements.txt';
    const venv  = detectVenv(chosenPath);
    const lines = [lnS(`Installing from ${file}`), lnP()];
    if (!venv.found) { lines.push(lnEr('No venv found')); return { lines }; }
    const fullFile = `${chosenPath}\\${file}`;
    if (!existsSync(fullFile)) { lines.push(lnEr(`${file} not found in ${chosenPath}`)); return { lines }; }
    const r = run(`"${venv.path}\\Scripts\\pip.exe" install -r "${fullFile}"`, { cwd: chosenPath });
    if (r.ok) {
      lines.push(lnOk('All dependencies installed'));
    } else {
      lines.push(lnEr(`pip failed: ${r.err}`));
    }
    return { lines };
  }

  return { lines:[ lnEr(`Unhandled flow: ${flow}`) ] };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  executeNewProject — runs after all new-project wizard steps complete
// ═══════════════════════════════════════════════════════════════════════════════
function executeNewProject(basePath, answers, C) {
  const name       = answers.projectName ?? 'my-project';
  const projPath   = `${basePath}\\${name}`;
  const pyVer      = answers.pythonVersion ?? 'System default';
  const venvChoice = answers.venvName ?? '.venv (recommended)';
  const venvName   = venvChoice.startsWith('.venv') ? '.venv'
                   : venvChoice === 'venv' ? 'venv'
                   : venvChoice === 'env'  ? 'env' : '.venv';
  const starters   = answers.starterFiles ?? [];
  const installChoice = answers.installChoice ?? 'No';
  const lines = [];

  // create project directory
  lines.push(lnS(`Creating ${projPath}`));
  try {
    mkdirSync(projPath, { recursive: true });
    lines.push(lnOk('Project folder created'));
  } catch(e) {
    lines.push(lnEr(`Cannot create folder: ${e.message}`));
    return { lines };
  }

  // starter files
  if (starters.length) {
    lines.push(lnP()); lines.push(lnS('Creating starter files'));
    const fileMap = {
      'requirements.txt':  '',
      '.gitignore':        '__pycache__/\n.venv/\nvenv/\n*.pyc\n.env\n',
      'README.md':         `# ${name}\n`,
      'main.py':           `def main():\n    pass\n\nif __name__ == "__main__":\n    main()\n`,
      '.env':              '# Environment variables\n',
    };
    for (const f of starters) {
      if (f === 'src/ folder') { mkdirSync(`${projPath}\\src`, { recursive: true }); continue; }
      if (fileMap[f] !== undefined) {
        writeFileSync(`${projPath}\\${f}`, fileMap[f]);
        lines.push(lnI(f, '', '#ff9500'));
      }
    }
  }

  // create venv
  lines.push(lnP()); lines.push(lnS('Creating virtual environment'));
  const pyFlag = pyVer !== 'System default' && !pyVer.includes('manually')
    ? ` -${pyVer}` : '';
  const venvR = run(`py${pyFlag} -m venv ${venvName}`, { cwd: projPath });
  if (!venvR.ok) {
    lines.push(lnEr(`venv creation failed: ${venvR.err}`));
    lines.push(lnPl(`Check: runex-env where`));
    return { lines };
  }
  lines.push(lnOk(`${venvName}\\ created`));

  // install from requirements if chosen
  if (installChoice === 'Yes — from requirements.txt') {
    const reqPath = `${projPath}\\requirements.txt`;
    if (existsSync(reqPath)) {
      lines.push(lnP()); lines.push(lnS('Installing from requirements.txt'));
      const rr = run(`"${projPath}\\${venvName}\\Scripts\\pip.exe" install -r requirements.txt`, { cwd: projPath });
      lines.push(rr.ok ? lnOk('Dependencies installed') : lnEr(`pip failed: ${rr.err}`));
    } else {
      lines.push(lnEr('requirements.txt not found — skipping install'));
    }
  }

  lines.push(lnP());
  lines.push(lnOk(`Project ready at ${projPath}`));
  lines.push(lnPl(`Activate: ${venvName}\\Scripts\\activate`));

  // save to recent projects
  const data = loadData();
  data.recentProjects = [
    { name, path: projPath, created: new Date().toISOString() },
    ...data.recentProjects.filter(p => p.path !== projPath),
  ].slice(0, 10);
  saveData(data);

  return { lines };
}
