import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@tabler/icons-webfont/dist/tabler-icons.min.css'
import './styles/tokens.css'
import './styles/dashboards.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
