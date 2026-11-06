import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// Installs the axios interceptor that authenticates every call to our API.
import './api'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
