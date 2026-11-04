import { forwardRef } from 'react';
import type { SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import './select-control.css';

export type SelectControlProps = SelectHTMLAttributes<HTMLSelectElement>;

export const SelectControl = forwardRef<HTMLSelectElement, SelectControlProps>(
  function SelectControl({ className, ...props }, ref) {
    return (
      <span className="select-control">
        <select
          {...props}
          ref={ref}
          className={['select-input', className].filter(Boolean).join(' ')}
        />
        <ChevronDown
          className="select-chevron"
          size={18}
          aria-hidden="true"
          focusable="false"
        />
      </span>
    );
  },
);
