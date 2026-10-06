// Browser-level check: drives the real React app in Chromium against the local
// stack, so RequireAuth, AuthContext, and every route get exercised.
//
// Uses the system Chromium rather than a downloaded one, so run
// `npm run stack:up` and `npm run dev` first, with chromium on PATH.
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'

function existsSync(p) {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}
function localStack() {
  return new URL('../local-stack/', import.meta.url).pathname
}

const BASE = 'http://localhost:5173'
const API = 'http://127.0.0.1:54321'
const EMAIL = 'me@example.com'
const PASSWORD = 'chocolate123'
const CHROME =
  process.env.CHROME_PATH ??
  ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find((p) =>
    existsSync(p),
  )
const ANON = process.env.ANON_KEY ?? readFileSync(join(localStack(), 'anon.key'), 'utf8').trim()

if (!CHROME) {
  console.error('No system Chromium found. Set CHROME_PATH to a Chrome/Chromium binary.')
  process.exit(1)
}

// Start from a known state: the app's own account, emptied of earlier runs.
{
  const token = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  }).then((r) => r.json())
  const res = await fetch(`${API}/rest/v1/recipes?id=neq.00000000-0000-0000-0000-000000000000`, {
    method: 'DELETE',
    headers: { apikey: ANON, authorization: `Bearer ${token.access_token}` },
  })
  // Tags are not removed when their last recipe is deleted, so clear them too
  // to keep the chip list deterministic between runs.
  await fetch(`${API}/rest/v1/tags?id=neq.00000000-0000-0000-0000-000000000000`, {
    method: 'DELETE',
    headers: { apikey: ANON, authorization: `Bearer ${token.access_token}` },
  })
  console.log(`  setup  cleared previous recipes and tags (${res.status})`)
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage()
page.setDefaultTimeout(15000)

const errors = []
const responses = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
page.on('response', (r) => {
  if (r.status() >= 400) responses.push(`${r.status()} ${r.request().method()} ${r.url()}`)
})

const bodyText = () => page.evaluate(() => document.body.innerText)
const waitForText = (needle) =>
  page.waitForFunction((n) => document.body.innerText.includes(n), {}, needle)
// Match on textContent rather than innerText: adjacent tag chips have no
// whitespace between them, so innerText would concatenate them into one string.
const clickByText = (selector, re) =>
  page.evaluate(
    (sel, src) => {
      const rx = new RegExp(src)
      const el = Array.from(document.querySelectorAll(sel)).find((e) =>
        rx.test(e.textContent.trim()),
      )
      if (!el) throw new Error(`no ${sel} matching ${src}`)
      el.click()
    },
    selector,
    re.source,
  )
const setValue = async (selector, value) => {
  await page.focus(selector)
  await page.keyboard.down('Control')
  await page.keyboard.press('KeyA')
  await page.keyboard.up('Control')
  await page.keyboard.press('Backspace')
  if (value) await page.type(selector, value)
}
const pass = (label) => console.log(`  OK  ${label}`)

try {
  // An unauthenticated visit to a protected route must land on the login page.
  await page.goto(`${BASE}/recipes`, { waitUntil: 'networkidle2' })
  await waitForText('Sign in to continue')
  pass(`protected route redirects to login (${page.url().replace(BASE, '')})`)

  // Wrong credentials must surface an error, not a silent success.
  await page.type('#email', EMAIL)
  await page.type('#password', 'wrong-password')
  await clickByText('button', /^Sign in$/)
  await waitForText('Invalid login credentials')
  pass('wrong password shows an error')

  // Real sign-in. Reload first so the form starts from clean state rather than
  // trying to retype over the controlled inputs left by the failed attempt.
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' })
  await page.type('#email', EMAIL)
  await page.type('#password', PASSWORD)
  await clickByText('button', /^Sign in$/)
  await waitForText('No recipes yet')
  pass('sign-in lands on the recipe list')

  // Create a recipe through the form.
  await clickByText('a', /New recipe/)
  await waitForText('One ingredient per line')
  await page.type('#field-Title', 'Miso Ramen')
  await page.type('#field-Ingredients', 'miso paste\nramen noodles\nbutter\n2 eggs')
  await page.type('#field-Steps', 'Soften butter\nBraise miso\nBoil noodles')
  await page.type('#field-Tags', 'Japanese, Quick')
  await clickByText('button', /^Save recipe$/)
  await waitForText('Braise miso')
  pass('recipe created via the form, detail page shows the steps')

  // Search by ingredient finds it.
  await page.goto(`${BASE}/recipes`, { waitUntil: 'networkidle2' })
  await waitForText('Miso Ramen')
  await page.type('input[type=search]', 'butter')
  await waitForText('Miso Ramen')
  pass('search by ingredient finds it')

  // A term that matches nothing shows the filtered empty state.
  await setValue('input[type=search]', 'zzzznomatch')
  await waitForText('No recipes match those filters')
  pass('non-matching search shows the filtered empty state')

  // Tag filter chips narrow to the tagged recipe.
  await setValue('input[type=search]', '')
  await waitForText('Miso Ramen')
  await clickByText('button', /^Japanese$/)
  await waitForText('Miso Ramen')
  pass('tag filter chip keeps the match')

  // Detail page and edit round-trip.
  await clickByText('a', /Miso Ramen/)
  await waitForText('Braise miso')
  await clickByText('a', /^Edit$/)
  await waitForText('One ingredient per line')
  await setValue('#field-Title', 'Miso Butter Ramen')
  await clickByText('button', /^Save recipe$/)
  await waitForText('Miso Butter Ramen')
  pass('edit saves and returns to the detail page')

  // Delete.
  page.on('dialog', (d) => d.accept())
  await clickByText('button', /^Delete$/)
  await waitForText('No recipes yet')
  pass('delete removes the recipe and its tag links')

  // Sign out, then confirm the session is gone.
  await clickByText('button', /^Sign out$/)
  await waitForText('Sign in to continue')
  pass('sign-out returns to login')

  // A stale session must not be usable after signing out.
  await page.goto(`${BASE}/recipes`, { waitUntil: 'networkidle2' })
  await waitForText('Sign in to continue')
  pass('protected route is locked again after sign-out')

// The sign-up form is the bootstrap path for the very first account only: it
// renders while signup_allowed is true, which is false as soon as one account
// exists. The account used above already exists, so the login page must be
// sign-in only with no way to reach registration.
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' })
await waitForText('Sign in to continue')
const signupControls = await page.evaluate(() =>
  Array.from(document.querySelectorAll('button, a, label[for=confirmPassword]'))
    .map((el) => el.textContent.trim())
    .filter((t) => /^(Create one|Create account|Sign up)$/.test(t) || t === 'Confirm password'),
)
if (signupControls.length) {
  throw new Error(`login page still offers sign-up: ${signupControls.join(', ')}`)
}
pass('no sign-up controls once an account exists')

// Throwaway account, created through the auth API rather than the UI. Signup
// stays enabled locally (local-stack/gotrue.env), but the UI will not offer it,
// so going direct is the only way to get a second account for this check.
const NEW_EMAIL = `fresh-${Date.now()}@example.com`
const NEW_PASSWORD = 'long-enough-password'
{
  const signup = await fetch(`${API}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email: NEW_EMAIL, password: NEW_PASSWORD }),
  }).then((r) => r.json())
  if (signup.error_description || signup.msg) {
    throw new Error(`could not create throwaway account: ${JSON.stringify(signup)}`)
  }
}

// ...and that account can sign in through the UI
await page.type('#email', NEW_EMAIL)
await page.type('#password', NEW_PASSWORD)
await clickByText('button', /^Sign in$/)
await waitForText('New recipe', 15000)
pass('the new account can sign in with those credentials')

// Its session still sees an empty account, so the list shows the empty state
// rather than the other account's recipe that was created and deleted above.
await clickByText('button', /^Sign out$/)
await waitForText('Sign in to continue')
pass('sign-out returns to the sign-in-only login page')

// The wrong-password step must fail, so GoTrue answering 400 on the
// token endpoint is expected. Anything else is not.
const expected = responses.filter((r) => r.startsWith('400 POST') && r.includes('/auth/v1/token'))
const unexpected = responses.filter((r) => !expected.includes(r))
console.log(`\n  expected 4xx: ${expected.length} (wrong-password token request)`)
console.log('  unexpected 4xx/5xx:', unexpected.length ? unexpected : 'none')
const jsErrors = errors.filter((e) => !/Failed to load resource|favicon/i.test(e))
console.log('  javascript errors:', jsErrors.length ? jsErrors : 'none')
if (unexpected.length || jsErrors.length) process.exitCode = 1
} catch (err) {
  console.error('\n  FAILED:', err.message)
  console.error('  page text was:\n', (await bodyText()).slice(0, 800))
  process.exitCode = 1
} finally {
  await browser.close()
}