#!/usr/bin/env node
// Bundles scripts/smoke.ts (which imports the app's real src/lib modules) and
// runs it against the local stack, injecting the same VITE_* values that Vite
// would inline at build time.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const project = new URL('..', import.meta.url).pathname
const anonKey = readFileSync(join(project, 'local-stack/anon.key'), 'utf8').trim()

// Inside the project so the external @supabase/supabase-js still resolves
// against the local node_modules.
const out = join(project, 'node_modules/.cache/recipe-smoke')
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const bundle = join(out, 'smoke.mjs')

try {
  execFileSync(
    'npx',
    [
      'esbuild',
      'scripts/smoke.ts',
      '--bundle',
      '--platform=node',
      '--format=esm',
      `--outfile=${bundle}`,
      '--external:@supabase/supabase-js',
      '--define:import.meta.env.VITE_SUPABASE_URL="http://127.0.0.1:54321"',
      `--define:import.meta.env.VITE_SUPABASE_ANON_KEY=${JSON.stringify(anonKey)}`,
      '--log-level=warning',
    ],
    { cwd: project, stdio: 'inherit' },
  )
  execFileSync(process.execPath, [bundle], { cwd: project, stdio: 'inherit' })
} finally {
  rmSync(out, { recursive: true, force: true })
}