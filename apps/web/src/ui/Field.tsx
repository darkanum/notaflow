import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { INPUT_CLASSES, LABEL_CLASSES, SELECT_CLASSES } from './classes';

// Malphas pairs label and control with for/id; wrapping does the same without ids to manage.
export function Field(props: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className={LABEL_CLASSES}>{props.label}</span>
      {props.children}
      {props.hint && <span className="text-xs text-muted">{props.hint}</span>}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${INPUT_CLASSES} ${props.className ?? ''}`} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`${INPUT_CLASSES} h-auto min-h-24 py-2 ${props.className ?? ''}`}
    />
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select {...props} className={SELECT_CLASSES} />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted"
      >
        ▾
      </span>
    </div>
  );
}
