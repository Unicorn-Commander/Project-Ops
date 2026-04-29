"use client";

import * as React from "react";
import { Moon, Sun, Monitor } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

const order = ["light", "dark", "system"] as const;
type ThemeName = (typeof order)[number];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const current: ThemeName = mounted && order.includes(theme as ThemeName)
    ? (theme as ThemeName)
    : "system";

  function next() {
    const idx = order.indexOf(current);
    setTheme(order[(idx + 1) % order.length]);
  }

  const Icon = current === "dark" ? Moon : current === "system" ? Monitor : Sun;
  const label = current === "dark" ? "Dark" : current === "system" ? "System" : "Light";

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={next}
      aria-label={`Theme: ${label} (click to cycle)`}
      title={`Theme: ${label}`}
    >
      <Icon className="h-5 w-5" />
    </Button>
  );
}
