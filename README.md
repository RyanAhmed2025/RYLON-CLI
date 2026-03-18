                                 ```
                                 ██████╗ ██╗   ██╗██╗      ██████╗ ███╗  ██╗
                                 ██╔══██╗╚██╗ ██╔╝██║     ██╔═══██╗████╗ ██║
                                 ██████╔╝ ╚████╔╝ ██║     ██║   ██║██╔██╗██║
                                 ██╔══██╗  ╚██╔╝  ██║     ██║   ██║██║╚████║
                                 ██║  ██║   ██║   ███████╗╚██████╔╝██║ ╚███║
                                 ╚═╝  ╚═╝   ╚═╝   ╚══════╝ ╚═════╝ ╚═╝  ╚══╝
                                                                         ```

**Astral Modular Development Framework** · CLI · v1.0.0

---

## What it is

Rylon is a personal terminal operating environment — a single CLI shell that runs tools, manages developer profiles, and executes task pipelines through a module system you extend by dropping folders in.

There is no config file to edit. There is no registry to update. A module is a folder with two files.

---

## The idea

Most developer tooling is either a sprawling monolith or a collection of disconnected scripts. Rylon sits between those — a shell with a defined visual language, a consistent interaction model, and a runtime that grows by addition rather than modification.

The core stays fixed. Capability is added sideways.

---

## Structure

```
rylon/
├── index.jsx          ◆ shell — handles all views, input, wizard runtime
├── package.json
├── rylon.bat          ◆ Windows launcher
└── modules/
    └── <name>/
        ├── module.json    name, description, version, color, commands
        └── index.js       handle(args, ctx) — returns output or starts a wizard
```

Drop a folder into `modules/`. Restart. It appears.

---

## Interaction model

Rylon has three states:

| State | Description |
|---|---|
| **Greeting** | Centered logo, module pills, navigable catalog |
| **Output** | Bordered blocks — one per command, scrollable history |
| **Context** | Active module sub-shell with contextual prompt |

Wizards run inside output blocks — questions chain downward as you answer them. Answered steps dim in place. The current step is always at the bottom.

---

## Running it

```bash
npm install
npm start
```

```bash
# Windows
rylon.bat
```

**Make it global:**
```bash
npm link
# then just: rylon
```

---

## Built-in commands

```
help              full reference + module addition guide
run               list installed modules
module <n>        enter module context
rylon clear       reset to greeting
rylon greet       print greeting summary
exit              quit
```

---

## Writing a module

A module exports one function:

```js
// modules/my-tool/index.js

export function handle(args, ctx) {
  const { C } = ctx;  // colour palette
  return {
    action: 'PUSH',
    lines: [
      { type: 'step',  text: 'Running my tool' },
      { type: 'ok',    text: 'Done' },
    ]
  };
}
```

```json
// modules/my-tool/module.json
{
  "name": "my-tool",
  "desc": "Does something useful",
  "version": "1.0.0",
  "status": "installed",
  "color": "#bf5fff",
  "commands": ["run", "status"]
}
```

Three return types: `PUSH` (output lines) · `WIZARD` (chained questions) · `LIST` (scrollable item list).

---

## Requirements

```
Node.js  >= 18.0.0
OS       Windows · macOS · Linux
Terminal Any ANSI-colour capable terminal
```

---

## Status

Single-developer project. Active. Scope is intentionally contained — the shell is stable, modules are the surface area.

---

*Built with [Ink](https://github.com/vadimdemedes/ink) — React for the terminal.*
