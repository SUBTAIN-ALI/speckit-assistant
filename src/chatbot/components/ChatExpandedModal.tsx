'use client';

import React, { useCallback, useEffect, useRef } from 'react';
import { X } from 'lucide-react';

type Props = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
};

export const ChatExpandedModal: React.FC<Props> = ({ open, onClose, children }) => {
  const overlayRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="relative w-[90vw] max-w-[900px] h-[90vh] max-h-[90vh] bg-white dark:bg-zinc-950 rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-800 flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 duration-300 max-sm:w-full max-sm:h-full max-sm:max-w-none max-sm:max-h-none max-sm:rounded-none">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 p-1.5 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
          aria-label="Close"
        >
          <X size={18} />
        </button>
        <div className="flex-1 min-h-0">
          {children}
        </div>
      </div>
    </div>
  );
};

export default ChatExpandedModal;
