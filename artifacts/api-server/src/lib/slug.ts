/**
 * Mirrors the slug rules used by the migration backfill so both agree.
 * Applied identically in SQL and in the API so a slug never drifts.
 */
export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "item";
}
