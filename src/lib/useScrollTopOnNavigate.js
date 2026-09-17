import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

// The content column scrolls, not the window (.shell pins the grid to one
// viewport -- see dashboards.css), so React Router's route change leaves the
// new page sitting at the previous page's scroll offset. Every dashboard
// shell attaches this ref to its scrolling column so each page opens at its
// own top.
export default function useScrollTopOnNavigate() {
  const ref = useRef(null)
  const { pathname } = useLocation()
  useEffect(() => {
    ref.current?.scrollTo({ top: 0 })
  }, [pathname])
  return ref
}
