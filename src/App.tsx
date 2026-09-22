import { Navigate, Route, Routes } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { RequireRole } from './auth/RequireRole'
import { ToastProvider } from './ui/ToastContext'
import { LoginPage } from './routes/LoginPage'
import { SetPasswordPage } from './routes/SetPasswordPage'
import { DashboardPage } from './routes/diretor/DashboardPage'
import { DiretorPedidosPage } from './routes/diretor/PedidosPage'
import { UploadPage } from './routes/faturista/UploadPage'
import { FaturistaPedidosPage } from './routes/faturista/PedidosPage'
import { VendedorPage } from './routes/vendedor/VendedorPage'
import { VendedorPedidosPage } from './routes/vendedor/PedidosPage'
import { LogisticaPage } from './routes/logistica/LogisticaPage'
import { ClientePage } from './routes/cliente/ClientePage'
import { FinanceiroPage } from './routes/financeiro/FinanceiroPage'
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
            path="/dashboard/pedidos"
            element={
              <RequireRole role="diretor">
                <DiretorPedidosPage />
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
            path="/operacoes/pedidos"
            element={
              <RequireRole role="faturista">
                <FaturistaPedidosPage />
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
          <Route
            path="/vendedor/pedidos"
            element={
              <RequireRole role="vendedor">
                <VendedorPedidosPage />
              </RequireRole>
            }
          />
          <Route
            path="/logistica"
            element={
              <RequireRole role="logistica">
                <LogisticaPage />
              </RequireRole>
            }
          />
          <Route
            path="/cliente"
            element={
              <RequireRole role="cliente">
                <ClientePage />
              </RequireRole>
            }
          />
          <Route
            path="/financeiro"
            element={
              <RequireRole role="financeiro">
                <FinanceiroPage />
              </RequireRole>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ToastProvider>
      <Analytics />
    </AuthProvider>
  )
}
