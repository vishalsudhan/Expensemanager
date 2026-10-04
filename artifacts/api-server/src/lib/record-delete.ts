export type RecordDeleteOutcome = {
  id: string;
  name: string;
  deleted: boolean;
  archived: boolean;
  usageCount: number;
};

/**
 * Records that expenses still point at are archived instead of being removed,
 * because expenses reference locations and categories with ON DELETE RESTRICT.
 * Archiving keeps every existing expense intact and still readable while taking
 * the record out of the pickers. This is the single place that rule lives.
 */
export function deleteOutcome(
  id: string,
  name: string,
  usageCount: number,
): RecordDeleteOutcome {
  return {
    id,
    name,
    deleted: usageCount === 0,
    archived: usageCount > 0,
    usageCount,
  };
}
