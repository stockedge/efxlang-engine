const FNV_OFFSET_BASIS_64 = 14695981039346656037n;
const FNV_PRIME_64 = 1099511628211n;
const MASK_64 = 0xffff_ffff_ffff_ffffn;

export function fnv1a(data: string | Uint8Array): string {
  let hash = FNV_OFFSET_BASIS_64;
  const bytes =
    typeof data === "string" ? new TextEncoder().encode(data) : data;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= BigInt(bytes[i]);
    hash = (hash * FNV_PRIME_64) & MASK_64;
  }
  return hash.toString(16).padStart(16, "0");
}
