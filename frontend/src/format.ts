// Every time is shown in the origin's time zone, with its abbreviation, so the
// driver reads the same clock they entered the departure in.

export function formatTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(iso))
}

export function formatClock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso))
}

export function zoneAbbreviation(timeZone: string, at = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(at)
  return parts.find((part) => part.type === 'timeZoneName')?.value ?? timeZone
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (!hours) return `${rest} min`
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

export function formatMiles(miles: number): string {
  return `${miles.toLocaleString('en-US')} mi`
}

/** "YYYY-MM-DDTHH:mm" for the next full hour in `timeZone`, the form's default departure. */
export function nextHourIn(timeZone: string): string {
  const next = new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000)
  return wallClockIn(next, timeZone)
}

/** A moment as "YYYY-MM-DDTHH:mm" on the wall clock of `timeZone`, for datetime-local inputs. */
export function wallClockIn(moment: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(moment)
      .map((part) => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}
