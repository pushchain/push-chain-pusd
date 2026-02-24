import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { PushChainProviders } from './providers/PushChainProviders.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PushChainProviders>
      <App />
    </PushChainProviders>
  </StrictMode>,
)