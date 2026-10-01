/** JSON-friendly copy: file objects become their path, Sets become arrays. */
export function plain(value: unknown): unknown {
  if (value instanceof Set) return Array.from(value, plain);
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.path === 'string' && typeof obj.basename === 'string') return { file: obj.path };
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, plain(v)]));
  }
  return value;
}

export function json(value: unknown): string {
  return JSON.stringify(plain(value), null, 2) + '\n';
}
