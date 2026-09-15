import React, { useRef, useState } from 'react';
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

interface UrlPopoverProps {
  children: React.ReactNode;
  onSubmit: (url: string) => void;
  defaultValue?: string;
  placeholder?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function UrlPopover({ children, onSubmit, defaultValue = '', placeholder = 'Enter URL...', open, onOpenChange }: UrlPopoverProps) {
  const [url, setUrl] = useState(defaultValue);
  const [internalOpen, setInternalOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;

  const handleOpenChange = (newOpen: boolean) => {
    if (!isControlled) {
      setInternalOpen(newOpen);
    }
    onOpenChange?.(newOpen);
    if (newOpen) {
      setUrl(defaultValue);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(url);
    handleOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        className="z-[9999] max-w-sm gap-3 rounded-xl p-4 shadow-2xl"
        data-note-editor-inside="true"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <DialogTitle className="text-sm font-semibold [color:var(--color-text-primary)]">Enter URL</DialogTitle>
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <label className="sr-only" htmlFor="url-popover-input">URL</label>
              <input
                ref={inputRef}
                id="url-popover-input"
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={placeholder}
                className="flex h-11 w-full rounded-md border px-3 py-2 text-sm shadow-sm transition-colors placeholder:[color:var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-action-primary)] [background:var(--color-surface-raised)] [border-color:var(--color-border-default)] [color:var(--color-text-primary)]"
              />
              <div className="flex justify-end gap-2 mt-1">
                <DialogClose asChild>
                  <button
                    type="button"
                    className="min-h-11 rounded-md px-3 py-1.5 text-sm font-medium transition-colors [color:var(--color-text-secondary)] hover:[background:var(--color-surface-sunken)]"
                  >
                    Cancel
                  </button>
                </DialogClose>
                <button
                  type="submit"
                  className="min-h-11 rounded-md px-3 py-1.5 text-sm font-medium shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--color-action-primary)] focus:ring-offset-2 [background:var(--color-action-primary)] [color:var(--color-text-inverse)] hover:[background:var(--color-action-primary-hover)]"
                >
                  Confirm
                </button>
              </div>
            </form>
      </DialogContent>
    </Dialog>
  );
}
