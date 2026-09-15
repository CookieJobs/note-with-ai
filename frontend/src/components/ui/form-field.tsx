import * as React from "react"

import { cn } from "@/lib/utils"

type FormFieldProps = {
  id: string
  label: React.ReactNode
  description?: React.ReactNode
  error?: React.ReactNode
  required?: boolean
  children: React.ReactElement
  className?: string
}

function FormField({
  id,
  label,
  description,
  error,
  required = false,
  children,
  className,
}: FormFieldProps) {
  const descriptionId = `${id}-description`
  const errorId = `${id}-error`
  const childProps = children.props as {
    "aria-describedby"?: string
    "aria-invalid"?: React.AriaAttributes["aria-invalid"]
    required?: boolean
  }
  const describedBy = [
    childProps["aria-describedby"],
    description ? descriptionId : undefined,
    error ? errorId : undefined,
  ]
    .filter(Boolean)
    .join(" ")

  return (
    <div className={cn("grid gap-2", className)}>
      <label className="font-medium [color:var(--color-text-primary)]" htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {React.cloneElement(children, {
        id,
        "aria-describedby": describedBy || undefined,
        "aria-invalid": error ? true : childProps["aria-invalid"],
        required: required || childProps.required,
      })}
      {description ? (
        <p id={descriptionId} className="text-sm [color:var(--color-text-secondary)]">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-sm [color:var(--color-status-error)]">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export { FormField, type FormFieldProps }
