# Repository Guidelines

## Project Structure & Module Organization

- `src/`: Core TypeScript engine code. Key modules live under `bytecode/`, `kernel/`, `lang/`, `trace/`, `vm/`, and the CLI entry under `cli/`.
- `web/`: Vite-powered browser UI. UI code is in `web/src/`, static assets in `web/public/`.
- `wasm/`: AssemblyScript shim (`deos_engine_shim.ts`) compiled to `web/public/deos_engine.wasm` and `.wat`.
- `test/`: Unit tests and custom runners (see Testing Guidelines).
- `dist-web/`: Generated browser build output (do not edit by hand).
- Specs and examples: `product_spec.md`, `ui_spec.md`, `spec.md`, plus sample inputs like `hello.efx`.

## Build, Test, and Development Commands

- `npm i`: Install dependencies.
- `npm run dev:browser`: Build WASM shim, then launch the Vite dev server.
- `npm run build:wasm`: Compile the AssemblyScript shim to `web/public/`.
- `npm run build:browser`: Production browser build.
- `npm run preview:browser`: Preview the production build locally.
- `npm run deos`: Run the CLI (`src/cli/index.ts`).
- `npm test`: Run Vitest unit tests.
- `npm run lint` / `npm run format`: Lint with ESLint and format with Prettier.
- `npm run type-check` / `npm run type-check:browser`: Type-check TS sources (root and `web/`).

## Coding Style & Naming Conventions

- TypeScript with 2-space indentation, single quotes, semicolons, and 100-character lines (Prettier).
- Keep ESLint clean (`--max-warnings=0`) before committing.
- Test files use `*.test.ts` (Vitest) and runner scripts follow `run_*_tests.ts`.

## Testing Guidelines

- Primary unit tests run via `npm test` (Vitest).
- Targeted suites can be run with ts-node, e.g. `npx ts-node --transpile-only test/run_integration_tests.ts` or other `run_*_tests.ts` files in `test/`.

## Commit & Pull Request Guidelines

- Recent commits use Conventional Commit-style prefixes like `feat:` and `chore:`. Follow that pattern with a short, imperative summary.
- PRs should include: a clear description, tests run (or “not run” with reason), and screenshots/GIFs for UI changes in `web/`.
- Link related issues/specs (e.g., `product_spec.md` or `ui_spec.md`) when applicable.
