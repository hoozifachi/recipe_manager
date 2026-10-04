import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { RedirectIfSignedIn, RequireAuth } from './auth/RequireAuth'
import { LoginPage } from './routes/LoginPage'
import { RecipeListPage } from './routes/RecipeListPage'
import { RecipeDetailPage } from './routes/RecipeDetailPage'
import { RecipeFormPage } from './routes/RecipeFormPage'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route
            path="/login"
            element={
              <RedirectIfSignedIn>
                <LoginPage />
              </RedirectIfSignedIn>
            }
          />

          <Route
            path="/"
            element={
              <RequireAuth>
                <RecipeListPage />
              </RequireAuth>
            }
          />
          <Route
            path="/recipes/new"
            element={
              <RequireAuth>
                <RecipeFormPage mode="create" />
              </RequireAuth>
            }
          />
          <Route
            path="/recipes/:id"
            element={
              <RequireAuth>
                <RecipeDetailPage />
              </RequireAuth>
            }
          />
          <Route
            path="/recipes/:id/edit"
            element={
              <RequireAuth>
                <RecipeFormPage mode="edit" />
              </RequireAuth>
            }
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}