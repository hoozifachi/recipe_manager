#!/usr/bin/env node
// Bundles scripts/smoke.ts (which imports the app's real src/lib modules) and
// runs it against a Supabase project, injecting the same VITE_* values that Vite
// would inline at build time.
//
// Defaults to whatever .env.local points at, which is the bundled local stack
// after `npm run stack:up`. To smoke-test a hosted project instead, export both
// variables so they take precedence over the file:
//
//   VITE_SUPABASE_URL=https://<ref>.supabase.co \
//   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_... npm run smoke
//
// This is destructive against whatever it is given: it signs up throwaway
// accounts and deletes all recipes and tags for the account it uses.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const project = new URL('..', import.meta.url).pathname

function readEnvFile(path) {
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (!match) continue
    out[match[1]] = match[2].replace(/^["'](.*)["']$/, '$1')
  }
  return out
}

// Fresh clone with no stack: fall back to the key the stack generated rather
// than failing before the bundle is even built.
const localEnv = readEnvFile(join(project, '.env.local'))
const url = process.env.VITE_SUPABASE_URL ?? localEnv.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const key =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  localEnv.VITE_SUPABASE_PUBLISHABLE_KEY ??
  readFileSync(join(project, 'local-stack/anon.key'), 'utf8').trim()

console.log(`smoke target: ${url}`)

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
      `--define:import.meta.env.VITE_SUPABASE_URL=${JSON.stringify(url)}`,
      `--define:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY=${JSON.stringify(key)}`,
      '--log-level=warning',
    ],
    { cwd: project, stdio: 'inherit' },
  )
  execFileSync(process.execPath, [bundle], { cwd: project, stdio: 'inherit' })
} finally {
  rmSync(out, { recursive: true, force: true })
}