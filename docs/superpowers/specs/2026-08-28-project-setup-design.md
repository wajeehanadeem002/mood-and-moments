# Mood & Moments Project Setup Design

## Goal

Initialize this empty folder as a production-ready Next.js development environment without implementing any Mood & Moments product interface or behavior.

## Scaffold

Use the official `create-next-app` 16.3.3 CLI in the current directory with pnpm, TypeScript, Tailwind CSS, ESLint, the App Router, a `src/` directory, and the `@/*` import alias. Retain the neutral generated starter page and the official configuration defaults.

The project will use the generated `src/app` route tree. Configuration and dependency manifests remain at the repository root, keeping application source separate from tooling configuration as the codebase grows.

## Project Boundaries

- Create only the official starter application, repository configuration, and setup documentation.
- Do not add Mood & Moments UI, routes, reusable product components, application state, persistence, APIs, or tests for product behavior.
- Add one project-specific script: `typecheck`, which runs `tsc --noEmit`.
- Use the generated pnpm lockfile to make dependency resolution reproducible.
- Do not change the machine's PowerShell execution policy.

## Runtime Flow

The App Router loads `src/app/layout.tsx` as the root layout and renders the neutral `src/app/page.tsx` route. `src/app/globals.css` provides the generated Tailwind-enabled global styles. No external data sources or runtime integrations are introduced.

## Failure Handling

Setup failures are handled at development time through the create-next-app exit status, ESLint, TypeScript, the production build, and a development-server HTTP smoke test. No custom application error routes are needed because there is no product behavior yet.

## Verification

Run the following checks with the Windows command shim where PowerShell would otherwise select the blocked script shim:

1. `pnpm.cmd lint`
2. `pnpm.cmd typecheck`
3. `pnpm.cmd build`
4. Start `pnpm.cmd dev`, request the local root URL, require an HTTP 200 response, and stop the server cleanly.

The setup is complete when all four checks succeed and Git shows only the intended scaffold and documentation files.
