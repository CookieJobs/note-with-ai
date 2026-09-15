"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"

import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogClose = DialogPrimitive.Close
const DialogTitle = DialogPrimitive.Title
const DialogDescription = DialogPrimitive.Description

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 [background:var(--color-surface-overlay)] motion-safe:animate-in motion-safe:fade-in-0",
      className,
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, onOpenAutoFocus, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      tabIndex={-1}
      className={cn(
        "fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-[var(--radius-lg)] border p-6 shadow-lg outline-none [background:var(--color-surface-raised)] [border-color:var(--color-border-default)] [color:var(--color-text-primary)] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95",
        className,
      )}
      onOpenAutoFocus={(event) => {
        onOpenAutoFocus?.(event)
        if (!event.defaultPrevented) {
          event.preventDefault()
          const content = event.currentTarget as HTMLElement
          content.focus()
        }
      }}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, ...props }, ref) => (
  <DialogContent
    ref={ref}
    className={cn(
      "left-auto right-0 top-0 h-full max-w-md translate-x-0 translate-y-0 rounded-none rounded-l-[var(--radius-lg)]",
      className,
    )}
    {...props}
  />
))
DrawerContent.displayName = "DrawerContent"

export {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
  DrawerContent,
}
