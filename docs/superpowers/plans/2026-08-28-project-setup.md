# Mood & Moments Project Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Initialize the repository as a verified Next.js application development environment without adding Mood & Moments product features.

**Architecture:** Generate the official Next.js starter in the repository root while placing application code under `src/app`. Preserve the generated App Router, TypeScript, Tailwind CSS, and ESLint configuration, adding only a standalone TypeScript checking script.

**Tech Stack:** Next.js 16.3.3, React, TypeScript, Tailwind CSS, ESLint, pnpm

**Spec:** `docs/superpowers/specs/2026-08-28-project-setup-design.md`

## Global Constraints

- Use pnpm through `pnpm.cmd` where the local PowerShell execution policy blocks `pnpm.ps1`.
- Use TypeScript, Tailwind CSS, ESLint, the App Router, `src/app`, and the `@/*` import alias.
- Keep the official neutral Next.js starter page; do not add Mood & Moments UI or behavior.
- Do not change the PowerShell execution policy.
- Do not overwrite unrelated files.
- Do not configure Git author identity or create commits because no repository identity is available.

---

### Task 1: Generate the official Next.js scaffold

**Files:**

- Create: `.gitignore`
- Create: `.vscode/settings.json`
- Create: `AGENTS.md`
- Create: `CLAUDE.md`
- Create: `README.md`
- Create: `eslint.config.mjs`
- Create: `next-env.d.ts`
- Create: `next.config.ts`
- Create: `package.json`
- Create: `pnpm-lock.yaml`
- Create: `pnpm-workspace.yaml`
- Create: `postcss.config.mjs`
- Create: `public/*` official starter assets
- Create: `src/app/favicon.ico`
- Create: `src/app/globals.css`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Create: `tsconfig.json`
- Preserve: `docs/superpowers/specs/2026-08-28-project-setup-design.md`
- Preserve: `docs/superpowers/plans/2026-08-28-project-setup.md`

**Interfaces:**

- Consumes: `create-next-app` 16.3.3 and pnpm 11.21.0 available on PATH.
- Produces: a root package manifest with `dev`, `build`, `start`, and `lint` scripts; a TypeScript App Router entry point at `src/app/page.tsx`; the `@/*` mapping in `tsconfig.json`.

- [ ] **Step 1: Run the official scaffold non-interactively**

```powershell
pnpm.cmd dlx create-next-app@16.3.3 . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm --yes
```

Expected: command exits with code 0, installs dependencies with pnpm, and retains the existing `docs/` directory.

- [ ] **Step 2: Inspect the generated project contract**

```powershell
Get-Content -Raw package.json
Get-Content -Raw tsconfig.json
Get-ChildItem -Recurse -File src/app | Select-Object FullName
```

Expected: `package.json` uses Next.js 16.3.3, `tsconfig.json` maps `@/*` to `./src/*`, and `src/app` contains the App Router starter files. The generated repository-local `.pnpm-store/` cache is ignored by Git.

### Task 2: Add the project type-check command

**Files:**

- Modify: `package.json`

**Interfaces:**

- Consumes: the generated TypeScript configuration and locally installed `typescript` binary.
- Produces: `pnpm typecheck`, mapped exactly to `tsc --noEmit`.

- [ ] **Step 1: Add the script without changing generated dependency versions**

Update the generated scripts object to include:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 2: Confirm the package manifest remains valid JSON**

```powershell
node -e "const p=require('./package.json'); if(p.scripts.typecheck!=='tsc --noEmit') process.exit(1)"
```

Expected: command exits with code 0.

### Task 3: Verify the complete development environment

**Files:**

- Inspect: all generated and modified project files
- Generate and ignore: `.next/` build and development output

**Interfaces:**

- Consumes: the completed scaffold and installed dependency graph from `pnpm-lock.yaml`.
- Produces: lint, type-check, build, and HTTP evidence that the environment works.

- [ ] **Step 1: Run ESLint**

```powershell
pnpm.cmd lint
```

Expected: exit code 0 with no ESLint errors.

- [ ] **Step 2: Run the TypeScript compiler check**

```powershell
pnpm.cmd typecheck
```

Expected: exit code 0 with no TypeScript errors.

- [ ] **Step 3: Create a production build**

```powershell
pnpm.cmd build
```

Expected: exit code 0 and a successfully generated static `/` route.

- [ ] **Step 4: Start the development server**

```powershell
pnpm.cmd dev
```

Expected: the server reports ready on a local HTTP URL.

- [ ] **Step 5: Request the root route while the server is running**

```powershell
$response = Invoke-WebRequest -Uri 'http://127.0.0.1:3000/' -UseBasicParsing
if ($response.StatusCode -ne 200) { throw "Unexpected HTTP status: $($response.StatusCode)" }
```

Expected: HTTP status 200 and starter page HTML.

- [ ] **Step 6: Stop the development server and inspect repository state**

```powershell
git status --short
git diff --check
```

Expected: only intended scaffold and documentation paths are present, build output remains ignored, and `git diff --check` reports no whitespace errors.
