import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '../auth/auth-context'
import { signupAllowed } from '../lib/queries'

/** Matches GOTRUE_PASSWORD_MIN_LENGTH in local-stack/gotrue.env. */
const MIN_PASSWORD_LENGTH = 6

const inputClass =
  'mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-stone-700'

function EmailField({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  return (
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
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
    </div>
  )
}

function PasswordField({
  id,
  autoComplete,
  value,
  onChange,
}: {
  id: string
  autoComplete: string
  value: string
  onChange: (next: string) => void
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-sm font-medium text-stone-700"
      >
        Password
      </label>
      <input
        id={id}
        type="password"
        autoComplete={autoComplete}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
    </div>
  )
}

function SubmitButton({
  disabled,
  label,
}: {
  disabled: boolean
  label: string
}) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="w-full rounded-md bg-stone-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-stone-700 disabled:opacity-50"
    >
      {label}
    </button>
  )
}

function Frame({
  subtitle,
  onSubmit,
  children,
}: {
  subtitle: string
  onSubmit: (event: FormEvent) => void
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">
          Recipes
        </h1>
        <p className="mt-1 text-sm text-stone-500">{subtitle}</p>

        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          {children}
        </form>
      </div>
    </div>
  )
}

/**
 * The only view once an account exists. `probeError` carries a failure from the
 * signup-allowed check, which is the one error this form has to show that did
 * not come from its own submit.
 */
function SignInForm({ probeError }: { probeError: string | null }) {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await signIn(email.trim(), password)
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not sign in.',
      )
      setSubmitting(false)
    }
  }

  const shownError = error ?? probeError

  return (
    <Frame subtitle="Sign in to continue" onSubmit={handleSubmit}>
      <EmailField value={email} onChange={setEmail} />
      <PasswordField
        id="password"
        autoComplete="current-password"
        value={password}
        onChange={setPassword}
      />
      {shownError && (
        <p role="alert" className="text-sm text-red-600">
          {shownError}
        </p>
      )}
      <SubmitButton
        disabled={submitting}
        label={submitting ? 'Signing in…' : 'Sign in'}
      />
    </Frame>
  )
}

/**
 * The single-user bootstrap path, offered only while no account exists. Once
 * one does, signup_allowed goes false and this is unreachable.
 */
function SignUpForm() {
  const { signUp } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setNotice(null)

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }

    setSubmitting(true)
    try {
      const signedIn = await signUp(email.trim(), password)
      if (!signedIn) {
        // No session means the deployment requires email confirmation first.
        // RedirectIfSignedIn moves us on automatically if one was issued.
        setPassword('')
        setConfirmPassword('')
        setNotice(
          'Account created. Check your email to confirm the address, then sign in.',
        )
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not create the account.',
      )
      setSubmitting(false)
    }
  }

  return (
    <Frame subtitle="Create your account" onSubmit={handleSubmit}>
      <EmailField value={email} onChange={setEmail} />
      <PasswordField
        id="password"
        autoComplete="new-password"
        value={password}
        onChange={setPassword}
      />

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

      <SubmitButton
        disabled={submitting}
        label={submitting ? 'Creating account…' : 'Create account'}
      />
    </Frame>
  )
}

export function LoginPage() {
  // null until the check resolves, so neither form flashes on its way to being
  // replaced by the other on a first visit.
  const [signupOpen, setSignupOpen] = useState<boolean | null>(null)
  const [probeError, setProbeError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    signupAllowed().then(
      (allowed) => {
        if (!active) return
        setSignupOpen(allowed)
      },
      (caught: unknown) => {
        if (!active) return
        // Fail closed: an unknown state must never unlock registration.
        setSignupOpen(false)
        setProbeError(
          caught instanceof Error
            ? caught.message
            : 'Could not check whether registration is open.',
        )
      },
    )

    return () => {
      active = false
    }
  }, [])

  if (signupOpen === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50">
        <p className="text-sm text-stone-500">Loading…</p>
      </div>
    )
  }

  if (signupOpen) {
    return <SignUpForm />
  }

  return <SignInForm probeError={probeError} />
}