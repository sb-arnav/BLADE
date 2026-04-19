// src/features/identity/EditSectionDialog.tsx
//
// Reusable edit-with-confirm Dialog for identity-data edits.
// Shared by SoulView + CharacterBible + PersonaView. Enforces the explicit-save
// flow (NO auto-save) mandated by D-153 / D-154 / D-155 — identity data is
// high-stakes; every mutation lands behind a visible Save button.
//
// @see .planning/phases/06-life-os-identity/06-PATTERNS.md §4
// @see .planning/phases/06-life-os-identity/06-CONTEXT.md §D-153 §D-154 §D-155
//
// Dialog primitive notes: the native <dialog> wrapper doesn't expose a `title`
// prop — we render the heading inside `children` and forward ariaLabel so
// screen readers still announce it (T-04-04 mitigation).

import { useEffect, useState } from 'react';
import { Dialog, Button } from '@/design-system/primitives';
import { useToast } from '@/lib/context';

export interface EditSectionDialogProps {
  open: boolean;
  /** Short label shown in the heading + toast (e.g. "identity", "curiosity"). */
  title: string;
  /** Initial textarea value. Re-applied each time the dialog (re)opens. */
  initialContent: string;
  onClose: () => void;
  /** Invoked with the new content. Dialog awaits the returned Promise. */
  onSave: (content: string) => Promise<void>;
  /** Optional textarea placeholder. */
  placeholder?: string;
}

export function EditSectionDialog(props: EditSectionDialogProps) {
  const { open, title, initialContent, onClose, onSave, placeholder } = props;
  const [value, setValue] = useState(initialContent);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  // Reset the editor every time the dialog opens with fresh initial content.
  // Without this, reopening the dialog on a different section would keep
  // stale text from the previous edit.
  useEffect(() => {
    if (open) setValue(initialContent);
  }, [open, initialContent]);

  const save = async () => {
    setBusy(true);
    try {
      await onSave(value);
      toast.show({ type: 'success', title: `Saved ${title}` });
      onClose();
    } catch (e) {
      toast.show({
        type: 'error',
        title: `Failed to save ${title}`,
        message: typeof e === 'string' ? e : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} ariaLabel={`Edit ${title}`}>
      <h3 className="identity-edit-dialog-title">Edit {title}</h3>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder ?? `Enter ${title}...`}
        rows={12}
        className="identity-edit-textarea"
        data-testid="identity-edit-textarea"
        disabled={busy}
      />
      <div className="identity-edit-dialog-actions">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </Dialog>
  );
}
