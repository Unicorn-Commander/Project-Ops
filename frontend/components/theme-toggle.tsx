"use client";

import * as React from "react";
import { Moon, Sun, Monitor, Sparkles } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

const order = ["light", "dark", "vibrant", "system"] as const;
type ThemeName = (typeof order)[number];

const META: Record<ThemeName, { icon: typeof Sun; label: string }> = {
  light: { icon: Sun, label: "Light" },
  dark: { icon: Moon, label: "Dark" },
  vibrant: { icon: Sparkles, label: "Vibrant" },
  system: { icon: Monitor, label: "System" },
};

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

  const { icon: Icon, label } = META[current];

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
