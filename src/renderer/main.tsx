import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App'

// macOS braucht oben links Platz für die Fensterknöpfe
document.body.dataset.platform = /Mac/i.test(navigator.userAgent) ? 'mac' : 'other'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
