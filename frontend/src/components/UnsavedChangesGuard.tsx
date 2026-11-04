import { useEffect, useSyncExternalStore } from 'react';
import { useBlocker } from 'react-router-dom';
import { getAuthoringDirty, subscribeAuthoringDirty } from './authoring';

export function UnsavedChangesGuard() {
  const dirty = useSyncExternalStore(
    subscribeAuthoringDirty,
    getAuthoringDirty,
  );
  const blocker = useBlocker(dirty);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm('Leave this page and discard unsaved changes?'))
      blocker.proceed();
    else blocker.reset();
  }, [blocker]);
  return null;
}
