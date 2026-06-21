import React from 'react';
import { Button } from '../ui/Button';
import { AdminPagination } from '../../services/admin';

interface PaginationBarProps {
  pagination: AdminPagination | null;
  onPrev: () => void;
  onNext: () => void;
}

export const PaginationBar: React.FC<PaginationBarProps> = ({ pagination, onPrev, onNext }) => {
  if (!pagination || pagination.pages <= 1) return null;
  const page = pagination.page || 1;
  const hasPrev = page > 1;
  const hasNext = page < pagination.pages;

  return (
    <div className="flex items-center justify-between pt-3">
      <p className="text-xs text-lantern-text-muted">
        Page {page} of {pagination.pages} · {pagination.total} total
      </p>
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" disabled={!hasPrev} onClick={onPrev}>
          Previous
        </Button>
        <Button variant="ghost" size="sm" disabled={!hasNext} onClick={onNext}>
          Next
        </Button>
      </div>
    </div>
  );
};
