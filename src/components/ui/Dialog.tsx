// Minimal dialog primitive — overlay + centered card. Uses a portal-
// less approach (renders inline) since polycoder doesn't have nested
// scroll containers that would clip it. Accessible via role=dialog +
// click-outside-to-close + ESC handling.

import { useEffect, type ReactNode } from 'react'
import { cn } from '@/lib/cn.js'

export type DialogProps = {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  className?: string
}

export function Dialog({ open, onClose, title, children, className }: DialogProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className={cn(
          'w-full max-w-md rounded-lg bg-white shadow-xl',
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-base font-semibold">{title}</h2>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}
