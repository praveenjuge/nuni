"use client"

import type { ReactNode } from "react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

/** Asks before something that can't be undone. Controlled, so any button or menu item can open it. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  action,
  destructive = false,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: ReactNode
  action: string
  destructive?: boolean
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? "destructive" : "default"}
            onClick={() => {
              onOpenChange(false)
              onConfirm()
            }}
          >
            {action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
