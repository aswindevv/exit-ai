import { useEffect, useState } from 'react'

/**
 * PageHead — greeting + subtitle on the left, chips on the right.
 * `chips` is an array of { tone, k?, v?, text? }:
 *   k/v renders the mockups' "label value" chip; text renders a plain one.
 */
const INDIA_TIME_ZONE = 'Asia/Kolkata'

export function greetingForIndia(date = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-IN', {
    hour: '2-digit',
    hourCycle: 'h23',
    timeZone: INDIA_TIME_ZONE,
  }).format(date))

  if (hour >= 5 && hour < 12) return 'Good morning'
  if (hour >= 12 && hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export default function PageHead({ greeting, name, subtitle, chips = [] }) {
  const [timedGreeting, setTimedGreeting] = useState(() => greetingForIndia())

  useEffect(() => {
    if (!name) return undefined
    const updateGreeting = () => setTimedGreeting(greetingForIndia())
    const interval = window.setInterval(updateGreeting, 60_000)
    window.addEventListener('focus', updateGreeting)
    document.addEventListener('visibilitychange', updateGreeting)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', updateGreeting)
      document.removeEventListener('visibilitychange', updateGreeting)
    }
  }, [name])

  const heading = name ? `${timedGreeting}, ${name}` : greeting

  return (
    <header className="page-head">
      <div className="page-head__copy">
        <h1 className="greeting">{heading}</h1>
        <p className="subtitle">{subtitle}</p>
      </div>
      <div className="chips">
        {chips.map((c, i) => (
          <span key={i} className={`chip ${c.tone}`}>
            {c.k ? (
              <>
                <span className="k">{c.k}</span> <span className="v">{c.v}</span>
              </>
            ) : (
              c.text
            )}
          </span>
        ))}
      </div>
    </header>
  )
}
