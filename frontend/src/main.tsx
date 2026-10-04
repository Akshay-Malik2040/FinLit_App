import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

if (import.meta.env.PROD) {
  const manifest = document.createElement('link')
  manifest.rel = 'manifest'
  manifest.href = '/manifest.webmanifest'
  document.head.appendChild(manifest)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
