import React from 'react';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', ...props }, ref) => (
    <input ref={ref} className={`lantern-field ${className}`.trim()} {...props} />
  )
);

Input.displayName = 'Input';
