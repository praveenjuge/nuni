"use client"

import { CheckIcon, CopyIcon } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"

export function CopyButton({
  value,
  label = "Copy",
  variant = "outline",
  className,
}: {
  value: string
  label?: string
  variant?: "outline" | "ghost" | "secondary" | "default"
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant={variant}
      size="sm"
      className={className}
      onClick={async () => {
        await navigator.clipboard.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      {copied ? "Copied" : label}
    </Button>
  )
}
