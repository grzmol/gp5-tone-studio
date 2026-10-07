"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Toggle as TogglePrimitive } from "radix-ui"

const toggleVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-pill text-xs font-semibold whitespace-nowrap text-silkscreen-2 transition-[color,background-color,box-shadow] outline-none hover:text-silkscreen focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-40 data-[state=on]:bg-lamp data-[state=on]:text-lamp-ink [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-white/4 shadow-[inset_0_0_0_1px_var(--glass-edge)] data-[state=on]:shadow-none",
        outline: "bg-transparent shadow-[inset_0_0_0_1px_var(--seam-strong)] hover:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.4)] data-[state=on]:shadow-none",
      },
      size: {
        default: "h-8 min-w-11 px-3",
        sm: "h-8 min-w-8 px-2.5",
        lg: "h-10 min-w-10 px-3.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> &
  VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
