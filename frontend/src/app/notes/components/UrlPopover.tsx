import React, { useState, useEffect } from 'react';
import { Slot } from '@radix-ui/react-slot';

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
    <>
      {isControlled ? (
        children
      ) : (
        <Slot onClick={() => handleOpenChange(true)}>
          {children}
        </Slot>
      )}
      
      {isOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/20 backdrop-blur-sm transition-all duration-100">
          <div 
            className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-4 shadow-2xl animate-in fade-in zoom-in-95"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-sm font-semibold text-slate-900">Enter URL</h3>
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <input
                autoFocus
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={placeholder}
                className="flex h-10 w-full rounded-md border border-slate-200 bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <div className="flex justify-end gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => handleOpenChange(false)}
                  className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                  Confirm
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
