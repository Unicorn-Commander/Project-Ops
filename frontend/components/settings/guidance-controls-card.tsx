"use client";

/**
 * Help & guidance controls card.
 *
 * Surfaces the in-app guidance layer (`lib/guidance.ts`) as a user-facing
 * setting:
 *   - "Show help tips" master switch ↔ useGuidance().tooltipsEnabled (default ON).
 *     Flipping it hides/reveals every <HelpHint>/coachmark across the app live.
 *   - "Reset tips & tours" button ↔ useGuidance().resetAll() — un-dismisses every
 *     hint and clears completed onboarding flows so guidance comes back from
 *     scratch (and re-enables tips if they were off).
 *
 * Guidance is a per-browser preference (localStorage), so there is no server
 * round-trip. The hook is hydration-safe: it reports the default (ON) on the
 * server + first client render, then swaps in the real value — so we don't gate
 * the Switch on `hydrated` for correctness, only use it to disable the control
 * for the one tick before the real preference is known.
 */

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { iconWellClass } from "@/lib/badge-styles";
import { HelpHint } from "@/components/guidance";
import { useGuidance } from "@/lib/guidance";
import { LifeBuoy, RotateCcw } from "lucide-react";

export function GuidanceControlsCard() {
  const { hydrated, tooltipsEnabled, setTooltipsEnabled, resetAll } =
    useGuidance();
  const { toast } = useToast();
  const [justReset, setJustReset] = useState(false);

  function handleReset() {
    resetAll();
    // resetAll() re-enables tips (defaults), so a hidden HelpHint reappears.
    setJustReset(true);
    toast({
      title: "Guidance reset",
      description:
        "Tips are on and every dismissed hint and tour will show again.",
    });
    // Brief affordance on the button label, then revert.
    setTimeout(() => setJustReset(false), 2000);
  }

  return (
    <Card className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <div
          className={`inline-flex h-9 w-9 items-center justify-center rounded-md ${iconWellClass(
            "blue",
          )}`}
        >
          <LifeBuoy className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <h2 className="text-xl font-semibold">Help &amp; guidance</h2>
            <HelpHint>
              Help tips are the small “?” bubbles and coachmarks throughout
              Project-Ops. This is a per-browser preference.
            </HelpHint>
          </div>
          <p className="text-xs text-muted-foreground">
            Control the in-app tips, hints, and product tour.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {/* Master "Show help tips" switch */}
        <div className="flex items-center justify-between rounded-md border p-4">
          <div className="pr-4">
            <Label
              htmlFor="guidance-tips-master"
              className="font-medium cursor-pointer"
            >
              Show help tips
            </Label>
            <p className="text-sm text-muted-foreground">
              Show the “?” hint bubbles and coachmarks across the app. On by
              default.
            </p>
          </div>
          <Switch
            id="guidance-tips-master"
            checked={tooltipsEnabled}
            onCheckedChange={setTooltipsEnabled}
            disabled={!hydrated}
            aria-label="Show help tips"
          />
        </div>

        {/* Replay tour / reset tips */}
        <div className="flex items-center justify-between rounded-md border p-4">
          <div className="pr-4">
            <p className="font-medium">Replay product tour &amp; reset tips</p>
            <p className="text-sm text-muted-foreground">
              Bring back every dismissed hint and re-show the onboarding tour
              from the beginning.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={handleReset}
            disabled={!hydrated}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            {justReset ? "Reset" : "Reset tips & tours"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
