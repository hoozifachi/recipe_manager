export function arrayToLines(value: string[]): string {
  return value.join('\n')
}

/** Splits tag input on commas, trims, drops blanks, and de-duplicates. */
export function parseTagNames(input: string): string[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const raw of input.split(',')) {
    const name = raw.trim()
    if (name === '' || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    names.push(name)
  }
  return names
}

export function formatMinutes(total: number | null): string {
  if (total === null) return ''
  if (total < 60) return `${total} min`
  const hours = Math.floor(total / 60)
  const mins = total % 60
  return mins === 0 ? `${hours} hr` : `${hours} hr ${mins} min`
}

export function formatTotalTime(prep: number | null, cook: number | null): string {
  const sum = (prep ?? 0) + (cook ?? 0)
  return formatMinutes(sum)
}