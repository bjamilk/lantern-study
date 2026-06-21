import React from 'react';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className = '', ...props }, ref) => (
    <textarea ref={ref} className={`lantern-field resize-y ${className}`.trim()} {...props} />
  )
);

Textarea.displayName = 'Textarea';
