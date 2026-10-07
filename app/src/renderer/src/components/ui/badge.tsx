import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

const badgeVariants = cva(
  "inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-pill px-2 text-[11px] font-semibold tracking-[0.04em] whitespace-nowrap uppercase transition-[color,box-shadow] focus-visible:outline-2 focus-visible:outline-ring [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-muted text-silkscreen-2",
        secondary: "bg-muted text-silkscreen-2",
        destructive: "bg-led-fault/14 text-led-fault",
        outline: "text-silkscreen-2 shadow-[inset_0_0_0_1px_var(--seam-strong)]",
        ghost: "text-silkscreen-2 [a&]:hover:bg-accent",
        link: "text-silkscreen-2 underline-offset-4 [a&]:hover:underline",
        lamp: "bg-lamp text-lamp-ink",
        ok: "bg-led-on/14 text-led-on",
        warn: "bg-led-warn/14 text-led-warn",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
