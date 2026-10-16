import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;

export function SheetContent({ className, children, title, description, width = "max-w-[640px]", ...p }:
  Omit<React.ComponentProps<typeof DialogPrimitive.Content>, "title"> & { title: React.ReactNode; description?: React.ReactNode; width?: string }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="animate-overlay-in fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" />
      <DialogPrimitive.Content
        className={cn("animate-slide-in fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-line bg-bg shadow-2xl", width, className)}
        {...p}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div className="min-w-0">
            <DialogPrimitive.Title className="text-[15px] font-semibold leading-snug">{title}</DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-1 text-xs text-muted">{description}</DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">Details panel</DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close data-testid="sheet-close-btn" className="rounded p-1 text-muted transition-colors hover:bg-panel-2 hover:text-text">
            <X className="size-4" />
          </DialogPrimitive.Close>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogContent({ className, children, title, description, ...p }:
  Omit<React.ComponentProps<typeof DialogPrimitive.Content>, "title"> & { title: React.ReactNode; description?: React.ReactNode }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="animate-overlay-in fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px]" />
      <DialogPrimitive.Content
        className={cn("fade-up fixed left-1/2 top-[8vh] z-50 max-h-[84vh] w-[min(560px,94vw)] -translate-x-1/2 overflow-y-auto rounded-xl border border-line-strong bg-panel p-6 shadow-2xl", className)}
        {...p}
      >
        <DialogPrimitive.Title className="text-base font-semibold">{title}</DialogPrimitive.Title>
        <DialogPrimitive.Description className={description ? "mt-1 text-xs text-muted" : "sr-only"}>{description ?? "Dialog"}</DialogPrimitive.Description>
        <DialogPrimitive.Close data-testid="dialog-close-btn" className="absolute right-4 top-4 rounded p-1 text-muted hover:bg-panel-2 hover:text-text">
          <X className="size-4" />
        </DialogPrimitive.Close>
        <div className="mt-5">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export const Dialog = DialogPrimitive.Root;
