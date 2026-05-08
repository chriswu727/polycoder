// Standard shadcn/ui utility for merging Tailwind classes.
// `cn(base, conditional && variant, override)` → conflict-resolved class string.

import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
