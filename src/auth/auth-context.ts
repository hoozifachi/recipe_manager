import { createContext, useContext } from 'react'
import type { Session } from '@supabase/supabase-js'

export type AuthValue = {
  session: Session | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  /** Resolves to true when sign-up signed the user in immediately. */
  signUp: (email: string, password: string) => Promise<boolean>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthValue | null>(null)

export function useAuth(): AuthValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used inside an AuthProvider')
  }
  return context
}