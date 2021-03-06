export function mapValues<T, R>(
  record: Record<string, T>,
  fn: (value: T, key: string) => R
): Record<string, R> {
  const res: Record<string, R> = {}
  Object.keys(record).forEach(key => {
    res[key] = fn(record[key], key)
  })
  return res
}

export function flatten<T>(list: (T | T[])[]): T[] {
  return list.reduce<T[]>((acc, item) => {
    return acc.concat(item)
  }, [])
}

export function clone<T>(value: T, changes: any): T {
  return {
    ...(value as any),
    ...changes
  }
}

export function range(min: number, max: number): number[] {
  return Array.apply(null, Array(max - min + 1)).map(
    (_: any, i: number) => min + i
  )
}

export function isObject(value: any): boolean {
  return value !== null && typeof value === 'object'
}
