export function fnv1a(data: string | Uint8Array): string {
  let hash = 2166136261;
  const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
