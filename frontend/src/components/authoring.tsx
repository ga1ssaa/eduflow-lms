import { useEffect, useId, useRef, type ReactNode } from 'react';
import { isApiError } from '../lib/client';
import '../authoring.css';

const dirtyForms = new Set<string>();
const subscribers = new Set<() => void>();
const notify = () => subscribers.forEach((listener) => listener());
export const getAuthoringDirty = () => dirtyForms.size > 0;
export function discardAuthoringChanges() {
  dirtyForms.clear();
  notify();
}
export function subscribeAuthoringDirty(listener: () => void) {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}
export function useAuthoringDirty(dirty: boolean) {
  const id = useId();
  const clear = () => {
    if (dirtyForms.delete(id)) notify();
  };
  useEffect(() => {
    if (dirty) dirtyForms.add(id);
    else dirtyForms.delete(id);
    notify();
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!getAuthoringDirty()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      if (dirtyForms.delete(id)) notify();
    };
  }, [dirty, id]);
  return clear;
}
export function Field({
  label,
  name,
  error,
  help,
  children,
}: {
  label: string;
  name: string;
  error?: string;
  help?: string;
  children: ReactNode;
}) {
  return (
    <label className="author-field">
      <span>{label}</span>
      {children}
      {help && (
        <span id={`${name}-help`} className="field-help">
          {help}
        </span>
      )}
      {error && (
        <span id={`${name}-error`} className="field-error">
          {error}
        </span>
      )}
    </label>
  );
}
export function fieldDescription(name: string, error?: string, help?: boolean) {
  return (
    [help && `${name}-help`, error && `${name}-error`]
      .filter(Boolean)
      .join(' ') || undefined
  );
}
export function MutationError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="author-error" role="alert">
      <strong>
        {isApiError(error) && error.status === 409
          ? 'This change could not be saved.'
          : 'Unable to save your changes.'}
      </strong>
      <p>
        {isApiError(error)
          ? error.status >= 500
            ? 'The service is temporarily unavailable. Please try again shortly.'
            : error.message
          : 'Check your connection and try again.'}
      </p>
      {isApiError(error) && error.status === 409 && (
        <p>
          The course has been refreshed. Your unsaved inputs are preserved.
          Review the latest content before trying again.
        </p>
      )}
    </div>
  );
}
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  pending = false,
  onConfirm,
  onCancel,
  danger = false,
  error,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
  error?: unknown;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    cancelRef.current?.focus();
    return () => {
      if (dialog.open) {
        if (typeof dialog.close === 'function') dialog.close();
        else dialog.removeAttribute('open');
      }
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="author-dialog surface"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onCancel();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      <div id={descriptionId} className="author-dialog-description">
        {children}
      </div>
      <MutationError error={error} />
      <div className="author-dialog-actions">
        <button
          ref={cancelRef}
          type="button"
          className="button secondary"
          disabled={pending}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className={`button ${danger ? 'author-danger' : 'primary'}`}
          disabled={pending}
          onClick={onConfirm}
        >
          {pending ? 'Working…' : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
