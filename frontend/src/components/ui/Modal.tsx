import React, { useEffect, useRef } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  titleId: string;
  children: React.ReactNode;
  className?: string;
  overlayClassName?: string;
}

/**
 * Accessible dialog shell: owns role="dialog"/aria-modal, a consolidated
 * Escape-to-close handler, and a focus trap (moves focus in on open, wraps
 * Tab at the boundaries, restores focus to the trigger on close). Callers
 * render their own header/body as children.
 */
export function Modal({
  isOpen,
  onClose,
  titleId,
  children,
  className = '',
  overlayClassName = '',
}: ModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(containerRef, isOpen);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150 ${overlayClassName}`}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`bg-raised border border-line-soft rounded-2xl shadow-2xl animate-in zoom-in-95 duration-150 ${className}`}
      >
        {children}
      </div>
    </div>
  );
}
