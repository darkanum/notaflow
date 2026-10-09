import { type ReactNode, useEffect, useId, useRef } from 'react';
import { MODAL_PANEL_CLASSES } from './classes';

export function Modal(props: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (props.open && !dialog.open) dialog.showModal();
    if (!props.open && dialog.open) dialog.close();
  }, [props.open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={props.onClose}
      className={`${MODAL_PANEL_CLASSES} backdrop:bg-black/50`}
    >
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 id={titleId} className="text-lg font-semibold text-fg">
          {props.title}
        </h2>
        <button
          type="button"
          aria-label="Fechar"
          className="rounded text-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          onClick={props.onClose}
        >
          ×
        </button>
      </div>
      {props.children}
    </dialog>
  );
}
