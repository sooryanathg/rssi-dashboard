import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import ActivityLog from './pages/ActivityLog.tsx'

function Layout() {
  const { pathname } = useLocation()
  const showLog = pathname === '/logs'
  return (
    <>
      <div style={{ display: showLog ? 'none' : 'block' }}>
        <App isVisible={!showLog} />
      </div>
      {showLog && <ActivityLog />}
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />} />
        <Route path="/logs" element={<Layout />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
