import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from './auth-context'

/**
 * Blocks a route until the session is known. `loading` must gate rendering, or
 * a refresh on a protected route would bounce the user to /login before
 * onAuthStateChange had a chance to restore the session.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50">
        <p className="text-sm text-stone-500">Loading…</p>
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return <>{children}</>
}

/** Keeps a signed-in user off the login screen. */
export function RedirectIfSignedIn({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50">
        <p className="text-sm text-stone-500">Loading…</p>
      </div>
    )
  }

  if (session) return <Navigate to="/" replace />

  return <>{children}</>
}