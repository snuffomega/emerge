import * as React from "react";
import { cn } from "@/lib/utils";

const field =
  "w-full rounded-md border border-line-strong bg-panel-2 px-2.5 text-[13px] text-text placeholder:text-faint transition-[border-color,background-color] duration-150 hover:border-faint focus:border-accent focus:outline-none disabled:opacity-50";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn(field, "h-8", className)} {...p} />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cn(field, "min-h-16 py-2 leading-relaxed", className)} {...p} />
));
Textarea.displayName = "Textarea";

export const NativeSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...p }, ref) => (
  <select ref={ref} className={cn(field, "h-8 cursor-pointer pr-7", className)} {...p}>
    {children}
  </select>
));
NativeSelect.displayName = "NativeSelect";

export function Label({ className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("eyebrow mb-1 block", className)} {...p} />;
}

export function Field({ label, hint, children, className }: { label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label>{label}</Label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-faint">{hint}</p>}
    </div>
  );
}
