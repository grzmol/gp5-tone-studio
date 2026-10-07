import * as React from "react"
import { cn } from "@/lib/utils"
import { Switch as SwitchPrimitive } from "radix-ui"

function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center rounded-pill p-[2px] transition-colors duration-[120ms] outline-none before:absolute before:-inset-x-0.5 before:-inset-y-1 before:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-40 data-[size=default]:h-[25px] data-[size=default]:w-[42px] data-[size=sm]:h-5 data-[size=sm]:w-[34px] data-[state=checked]:bg-switch-on data-[state=unchecked]:bg-switch-off",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block rounded-full bg-white shadow-[0_2px_4px_rgb(0_0_0/0.3)] transition-transform duration-[160ms] ease-out group-data-[size=default]/switch:size-[21px] group-data-[size=sm]/switch:size-4 data-[state=checked]:translate-x-[17px] group-data-[size=sm]/switch:data-[state=checked]:translate-x-[14px] data-[state=unchecked]:translate-x-0"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
