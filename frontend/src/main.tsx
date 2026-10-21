import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/source-sans-3/index.css'
import '@fontsource-variable/fraunces/opsz.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-500.css'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { AuthProvider } from './contexts/AuthContext.tsx'
import { MotionRoot } from './components/ui/MotionRoot.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <MotionRoot>
          <App />
        </MotionRoot>
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
)
