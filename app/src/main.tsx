import { Buffer } from 'buffer'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { PushChainProviders } from './providers/PushChainProviders.tsx'

// Polyfill Buffer for browser compatibility
window.Buffer = Buffer

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PushChainProviders>
      <App />
    </PushChainProviders>
  </StrictMode>,
)