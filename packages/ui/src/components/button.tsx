import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "border-primary bg-primary text-primary-foreground",
        outline:
          "border-border bg-card text-foreground aria-expanded:bg-muted dark:border-input dark:bg-input/30",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        /* Sidebar link: muted until hovered or marked aria-current="page" */
        nav: "text-muted-foreground hover:bg-muted hover:text-foreground aria-[current=page]:bg-muted aria-[current=page]:text-foreground",
        /* Bare text action, e.g. "Dismiss" or a back link */
        subtle: "font-normal text-muted-foreground",
        /* Pill suggestion, the only bordered button with a hover state in the design */
        chip: "border-border bg-card font-normal text-foreground hover:bg-muted",
        destructive:
          "bg-destructive text-destructive-foreground focus-visible:border-destructive/40 focus-visible:ring-destructive/20",
        "destructive-outline":
          "border-border bg-transparent text-destructive focus-visible:border-destructive/40 focus-visible:ring-destructive/20",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8.5 gap-2 px-3.5 text-[13px] [&_svg:not([class*='size-'])]:size-3.5",
        compact: "h-8.5 gap-2 px-3 text-[13px] [&_svg:not([class*='size-'])]:size-3.5",
        xs: "h-6 gap-1 rounded-sm px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7.5 gap-1.5 rounded-md px-3 text-[13px] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-3.5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        nav: "h-9 w-full justify-between rounded-md px-2.5 text-sm",
        text: "h-auto p-0 text-[13px]",
        chip: "h-7 rounded-full px-2.5 text-[12.5px]",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-sm in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-md in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
