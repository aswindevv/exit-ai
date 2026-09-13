export function fmtDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

export function initials(fullName) {
  if (!fullName) return ''
  return fullName.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')
}

export function daysUntil(dateStr) {
  const ms = new Date(dateStr) - new Date(new Date().toDateString())
  return Math.round(ms / 86400000)
}
