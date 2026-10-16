import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;
export function TabsList({ className, ...p }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn("inline-flex items-center gap-0.5 rounded-lg border border-line bg-panel p-0.5", className)} {...p} />;
}
export function TabsTrigger({ className, ...p }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn("rounded-md px-3 py-1 text-[12.5px] font-medium text-muted transition-colors hover:text-text data-[state=active]:bg-panel-2 data-[state=active]:text-text data-[state=active]:shadow-[inset_0_0_0_1px_var(--line-strong)]", className)}
      {...p}
    />
  );
}
export const TabsContent = TabsPrimitive.Content;

export const TooltipProvider = TooltipPrimitive.Provider;
export function Tip({ content, children, side = "top" }: { content: React.ReactNode; children: React.ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <TooltipPrimitive.Root delayDuration={150}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content side={side} sideOffset={6} className="fade-up z-[70] max-w-72 rounded-md border border-line-strong bg-panel px-2.5 py-1.5 text-xs leading-relaxed text-text shadow-xl">
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export function Switch({ className, ...p }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root className={cn("relative h-[18px] w-8 shrink-0 cursor-pointer rounded-full border border-line-strong bg-panel-2 transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent", className)} {...p}>
      <SwitchPrimitive.Thumb className="block size-3 translate-x-[2px] rounded-full bg-muted transition-transform data-[state=checked]:translate-x-[15px] data-[state=checked]:bg-accent-ink" />
    </SwitchPrimitive.Root>
  );
}

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export function PopoverContent({ className, ...p }: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content sideOffset={6} align="start" className={cn("fade-up z-50 min-w-56 rounded-lg border border-line-strong bg-panel p-1.5 shadow-2xl", className)} {...p} />
    </PopoverPrimitive.Portal>
  );
}

export function Checkbox({ className, ...p }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root className={cn("flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-line-strong bg-panel-2 transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent", className)} {...p}>
      <CheckboxPrimitive.Indicator>
        <Check className="size-3 text-accent-ink" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

const badgeTones: Record<string, string> = {
  neutral: "border-line-strong text-muted",
  verified: "border-verified/40 text-verified bg-verified/10",
  accepted: "border-accepted/50 text-accepted",
  failed: "border-failed/40 text-failed bg-failed/10",
  progress: "border-progress/40 text-progress bg-progress/10",
  usage: "border-usage/40 text-usage bg-usage/10",
  synthetic: "border-progress/50 text-progress stripes",
};
export function Badge({ tone = "neutral", className, ...p }: React.HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof badgeTones | string }) {
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-[1px] font-mono text-[10.5px] uppercase tracking-wide", badgeTones[tone] ?? badgeTones.neutral, className)} {...p} />;
}
