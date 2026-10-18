import { cn } from "../lib/utils";

function Spinner({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cn(
        "inline-block size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-r-transparent [animation-duration:0.7s]",
        className,
      )}
      {...props}
    />
  );
}

export { Spinner };
