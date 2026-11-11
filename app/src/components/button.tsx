import type { ButtonHTMLAttributes } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" };

const variants = {
  primary: "bg-green-600 text-on-accent hover:bg-green-700 disabled:opacity-60",
  secondary: "border border-border bg-bg text-text hover:bg-surface disabled:opacity-60",
};

export function Button({ variant = "primary", className = "", type = "button", ...rest }: Props) {
  return (
    <button
      type={type}
      className={`inline-flex h-10 items-center justify-center rounded-control px-4 text-button font-semibold transition-colors ${variants[variant]} ${className}`}
      {...rest}
    />
  );
}
