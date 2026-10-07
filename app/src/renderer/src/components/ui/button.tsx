import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-[7px] rounded-pill text-[13px] font-medium whitespace-nowrap transition-[transform,background-color,box-shadow,color] duration-[120ms] outline-none select-none active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-40 aria-invalid:outline-led-fault [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-lamp font-semibold text-lamp-ink hover:bg-white/88",
        destructive: "bg-destructive-fill font-semibold text-white hover:bg-[color-mix(in_srgb,var(--destructive-fill)_88%,#000)]",
        outline:
          "bg-white/9 text-silkscreen shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_0_0_1px_var(--glass-edge)] hover:bg-white/15 hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.24),0_0_0_1px_rgb(255_255_255/0.2)]",
        secondary:
          "bg-white/9 text-silkscreen shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_0_0_1px_var(--glass-edge)] hover:bg-white/15",
        ghost: "text-silkscreen-2 hover:bg-accent hover:text-silkscreen",
        link: "h-auto px-0 text-silkscreen-2 underline decoration-seam-strong underline-offset-[3px] hover:text-silkscreen",
      },
      size: {
        default: "h-[34px] px-4 has-[>svg]:px-3.5",
        xs: "h-7 gap-1 px-2.5 text-xs has-[>svg]:px-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 px-3 text-xs has-[>svg]:px-2.5",
        lg: "h-10 px-6 has-[>svg]:px-5",
        icon: "size-[34px]",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
