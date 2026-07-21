import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { RequireRole } from './auth/RequireRole'
import { ToastProvider } from './ui/ToastContext'
import { LoginPage } from './routes/LoginPage'
import { SetPasswordPage } from './routes/SetPasswordPage'
import { DashboardPage } from './routes/diretor/DashboardPage'
import { UploadPage } from './routes/faturista/UploadPage'
import { VendedorPage } from './routes/vendedor/VendedorPage'
import { roleHome } from './lib/roleHome'

function RootRedirect() {
  const { session, profile, loading } = useAuth()
  if (loading) return null
  if (!session) return <Navigate to="/login" replace />
  if (!profile) return <Navigate to="/login" replace />
  return <Navigate to={roleHome(profile.role)} replace />
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/definir-senha" element={<SetPasswordPage />} />
          <Route
            path="/dashboard"
            element={
              <RequireRole role="diretor">
                <DashboardPage />
              </RequireRole>
            }
          />
          <Route
            path="/operacoes"
            element={
              <RequireRole role="faturista">
                <UploadPage />
              </RequireRole>
            }
          />
          <Route
            path="/vendedor"
            element={
              <RequireRole role="vendedor">
                <VendedorPage />
              </RequireRole>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ToastProvider>
    </AuthProvider>
  )
}
