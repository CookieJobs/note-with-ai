"use client"

import * as React from "react"
import {
  FloatingFocusManager,
  FloatingList,
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useListItem,
  useListNavigation,
  useRole,
} from "@floating-ui/react"

import { cn } from "@/lib/utils"

type MenuContextValue = {
  activeIndex: number | null
  context: ReturnType<typeof useFloating>["context"]
  getFloatingProps: ReturnType<typeof useInteractions>["getFloatingProps"]
  getItemProps: ReturnType<typeof useInteractions>["getItemProps"]
  getReferenceProps: ReturnType<typeof useInteractions>["getReferenceProps"]
  listRef: React.MutableRefObject<Array<HTMLElement | null>>
  open: boolean
  refs: ReturnType<typeof useFloating>["refs"]
  setActiveIndex: React.Dispatch<React.SetStateAction<number | null>>
  setOpen: (open: boolean) => void
  floatingStyles: React.CSSProperties
}

const MenuContext = React.createContext<MenuContextValue | null>(null)

function useMenuContext() {
  const value = React.useContext(MenuContext)
  if (!value) throw new Error("Menu components must be rendered inside Menu")
  return value
}

function Menu({ children }: { children: React.ReactNode }) {
  const [open, setOpenState] = React.useState(false)
  const [activeIndex, setActiveIndex] = React.useState<number | null>(null)
  const listRef = React.useRef<Array<HTMLElement | null>>([])
  const { context, floatingStyles, refs } = useFloating({
    open,
    onOpenChange(nextOpen) {
      setOpenState(nextOpen)
      setActiveIndex(nextOpen ? 0 : null)
    },
    placement: "bottom-start",
    middleware: [offset(6), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  })
  const click = useClick(context)
  const dismiss = useDismiss(context)
  const role = useRole(context, { role: "menu" })
  const listNavigation = useListNavigation(context, {
    listRef,
    activeIndex,
    onNavigate: setActiveIndex,
    loop: true,
    focusItemOnOpen: false,
  })
  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions([
    click,
    dismiss,
    role,
    listNavigation,
  ])

  const setOpen = React.useCallback((nextOpen: boolean) => {
    setOpenState(nextOpen)
    setActiveIndex(nextOpen ? 0 : null)
  }, [])

  React.useEffect(() => {
    if (!open || activeIndex === null) return
    const frame = window.requestAnimationFrame(() => {
      const index = activeIndex === -1 ? listRef.current.length - 1 : activeIndex
      if (index !== activeIndex) setActiveIndex(index)
      listRef.current[index]?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeIndex, open])

  return (
    <MenuContext.Provider
      value={{
        activeIndex,
        context,
        floatingStyles,
        getFloatingProps,
        getItemProps,
        getReferenceProps,
        listRef,
        open,
        refs,
        setActiveIndex,
        setOpen,
      }}
    >
      {children}
    </MenuContext.Provider>
  )
}

const MenuTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<"button">
>(({ className, onKeyDown, ...props }, forwardedRef) => {
  const { getReferenceProps, refs, setActiveIndex, setOpen } = useMenuContext()

  return (
    <button
      ref={(node) => {
        refs.setReference(node)
        if (typeof forwardedRef === "function") forwardedRef(node)
        else if (forwardedRef) forwardedRef.current = node
      }}
      type="button"
      className={cn(
        "inline-flex items-center rounded-[var(--radius-md)] px-3 py-2 [color:var(--color-text-primary)] hover:[background:var(--color-action-secondary-hover)]",
        className,
      )}
      {...(getReferenceProps({
        onKeyDown(event) {
          onKeyDown?.(event as React.KeyboardEvent<HTMLButtonElement>)
          if (event.defaultPrevented) return
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault()
            setActiveIndex(event.key === "ArrowDown" ? 0 : -1)
            setOpen(true)
          }
        },
      }) as React.ButtonHTMLAttributes<HTMLButtonElement>)}
      {...props}
    />
  )
})
MenuTrigger.displayName = "MenuTrigger"

const MenuContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<"div">
>(({ className, children, style, ...props }, forwardedRef) => {
  const { context, floatingStyles, getFloatingProps, listRef, open, refs } = useMenuContext()
  const floatingProps = getFloatingProps(props) as React.HTMLAttributes<HTMLDivElement>
  if (!open) return null

  return (
    <FloatingPortal>
      <FloatingFocusManager context={context} modal={false} initialFocus={-1}>
        <div
          ref={(node) => {
            refs.setFloating(node)
            if (typeof forwardedRef === "function") forwardedRef(node)
            else if (forwardedRef) forwardedRef.current = node
          }}
          className={cn(
            "z-50 min-w-40 rounded-[var(--radius-md)] border p-1 shadow-lg outline-none [background:var(--color-surface-raised)] [border-color:var(--color-border-default)] [color:var(--color-text-primary)]",
            className,
          )}
          style={{ ...floatingStyles, ...style }}
          {...floatingProps}
          aria-labelledby={props["aria-label"] ? undefined : floatingProps["aria-labelledby"]}
        >
          <FloatingList elementsRef={listRef}>{children}</FloatingList>
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  )
})
MenuContent.displayName = "MenuContent"

const MenuItem = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<"button">
>(({ className, onClick, onKeyDown, disabled, ...props }, forwardedRef) => {
  const { activeIndex, getItemProps, setOpen } = useMenuContext()
  const { ref, index } = useListItem()

  return (
    <button
      ref={(node) => {
        ref(node)
        if (typeof forwardedRef === "function") forwardedRef(node)
        else if (forwardedRef) forwardedRef.current = node
      }}
      type="button"
      disabled={disabled}
      className={cn(
        "flex w-full items-center rounded-[var(--radius-sm)] px-3 py-2 text-left text-sm hover:[background:var(--color-action-secondary-hover)] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...(getItemProps({
        onClick(event) {
          onClick?.(event as React.MouseEvent<HTMLButtonElement>)
          if (!event.defaultPrevented) setOpen(false)
        },
        onKeyDown(event) {
          onKeyDown?.(event as React.KeyboardEvent<HTMLButtonElement>)
          if (!event.defaultPrevented && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault()
            event.currentTarget.click()
          }
        },
        role: "menuitem",
        tabIndex: activeIndex === index ? 0 : -1,
      }) as React.ButtonHTMLAttributes<HTMLButtonElement>)}
      {...props}
    />
  )
})
MenuItem.displayName = "MenuItem"

export { Menu, MenuTrigger, MenuContent, MenuItem }
