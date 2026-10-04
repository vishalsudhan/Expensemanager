import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

export type RecordKind = 'location' | 'category' | 'project' | 'label';

type DeleteRecordDialogProps = {
  open: boolean;
  kind: RecordKind;
  name: string;
  usageCount: number;
  childCount?: number;
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

const NOUNS: Record<RecordKind, string> = {
  location: 'location',
  category: 'category',
  project: 'project',
  label: 'label',
};

const expenseWord = (count: number) => (count === 1 ? 'expense' : 'expenses');
const subcategoryWord = (count: number) => (count === 1 ? 'subcategory' : 'subcategories');

export function DeleteRecordDialog({
  open,
  kind,
  name,
  usageCount,
  childCount = 0,
  busy = false,
  onOpenChange,
  onConfirm,
}: DeleteRecordDialogProps) {
  const noun = NOUNS[kind];
  const referenced = usageCount > 0 || childCount > 0;
  const willArchive = referenced;

  return (
    <AlertDialog open={open} onOpenChange={(value) => { if (!value && !busy) onOpenChange(false); }}>
      <AlertDialogContent className="rounded-[22px] border-border bg-card" data-testid={`dialog-delete-${noun}`}>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display text-xl tracking-[-.03em]" data-testid={`title-delete-${noun}`}>
            {willArchive ? `Archive ${name}?` : `Delete ${name}?`}
          </AlertDialogTitle>
          <AlertDialogDescription data-testid={`description-delete-${noun}`}>
            {referenced ? (
              <span className="block space-y-2">
                <span className="block font-medium text-foreground" data-testid={`warning-delete-${noun}`}>
                  {usageCount > 0
                    ? `${usageCount} ${expenseWord(usageCount)} still ${usageCount === 1 ? 'uses' : 'use'} this ${noun}.`
                    : null}
                  {childCount > 0
                    ? ` ${childCount} ${subcategoryWord(childCount)} ${childCount === 1 ? 'sits' : 'sit'} under it.`
                    : null}
                </span>
                <span className="block">
                  Nothing will be lost. It will be <strong>archived instead of deleted</strong>, so those
                  records keep working and stay readable, and it will no longer be offered when you add
                  something new.
                </span>
              </span>
            ) : (
              <span className="block">
                Nothing uses this {noun}, so it will be removed for good. This cannot be undone.
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} data-testid={`button-cancel-delete-${noun}`}>
            Keep {noun}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(event) => { event.preventDefault(); onConfirm(); }}
            data-testid={`button-confirm-delete-${noun}`}
          >
            {busy ? (willArchive ? 'Archiving…' : 'Deleting…') : willArchive ? `Archive ${noun}` : `Delete ${noun}`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
