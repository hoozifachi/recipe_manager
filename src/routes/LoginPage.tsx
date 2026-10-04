import { useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '../auth/auth-context'

/** Matches GOTRUE_PASSWORD_MIN_LENGTH in local-stack/gotrue.env. */
const MIN_PASSWORD_LENGTH = 6

type Mode = 'sign-in' | 'sign-up'

export function LoginPage() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState<Mode>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const signingUp = mode === 'sign-up'

  function switchMode(next: Mode) {
    setMode(next)
    setError(null)
    setNotice(null)
    setPassword('')
    setConfirmPassword('')
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setNotice(null)

    if (signingUp && password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    if (signingUp && password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }

    setSubmitting(true)
    try {
      if (signingUp) {
        const signedIn = await signUp(email.trim(), password)
        if (!signedIn) {
          // No session means the deployment wants the address confirmed first.
          // RedirectIfSignedIn will move us on automatically if one was issued.
          setMode('sign-in')
          setPassword('')
          setConfirmPassword('')
          setNotice(
            'Account created. Check your email to confirm the address, then sign in.',
          )
        }
      } else {
        await signIn(email.trim(), password)
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : signingUp
            ? 'Could not create the account.'
            : 'Could not sign in.',
      )
      setSubmitting(false)
    }
  }

  const inputClass =
    'mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-stone-900'

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">
          Recipes
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          {signingUp ? 'Create your account' : 'Sign in to continue'}
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-stone-700"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-stone-700"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete={
                signingUp ? 'new-password' : 'current-password'
              }
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </div>

          {signingUp && (
            <div>
              <label
                htmlFor="confirmPassword"
                className="block text-sm font-medium text-stone-700"
              >
                Confirm password
              </label>
              <input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={inputClass}
              />
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}

          {notice && (
            <p role="status" className="text-sm text-stone-600">
              {notice}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-stone-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-stone-700 disabled:opacity-50"
          >
            {submitting
              ? signingUp
                ? 'Creating account…'
                : 'Signing in…'
              : signingUp
                ? 'Create account'
                : 'Sign in'}
          </button>
        </form>

        <p className="mt-6 text-sm text-stone-500">
          {signingUp ? 'Already have an account?' : 'No account yet?'}{' '}
          <button
            type="button"
            onClick={() => switchMode(signingUp ? 'sign-in' : 'sign-up')}
            className="font-medium text-stone-900 underline underline-offset-2"
          >
            {signingUp ? 'Sign in' : 'Create one'}
          </button>
        </p>
      </div>
    </div>
  )
}