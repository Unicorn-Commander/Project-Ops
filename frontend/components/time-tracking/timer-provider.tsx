"use client";

/**
 * Running-timer context. Mounted once in the dashboard chrome (above the
 * routed page content) so a running timer survives client-side navigation —
 * the provider holds the running entry in state, ticks a local clock every
 * second, and reconciles with the server.
 *
 * Source of truth is the backend: on mount (and on workspace change) it calls
 * GET /time-entries/timer/running. Start/stop go through the API and update
 * the context optimistically. Other surfaces (e.g. starting a timer from the
 * Time entries page) can call `refresh()` to re-sync the widget.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  getRunningTimer,
  startTimer as apiStartTimer,
  stopTimer as apiStopTimer,
  type StartTimerInput,
  type TimeEntry,
} from "@/lib/time-tracking-api";
import { WORKSPACE_STORAGE_KEY } from "@/lib/workspace";

interface TimerContextValue {
  /** The currently running entry, or null. */
  running: TimeEntry | null;
  /** Elapsed seconds for the running entry, ticking locally each second. */
  elapsedSeconds: number;
  /** True until the first /running fetch resolves. */
  loading: boolean;
  /** Start a timer; resolves to the new running entry. Throws on error. */
  start: (input: StartTimerInput) => Promise<TimeEntry>;
  /** Stop the running timer; resolves to the stopped entry. */
  stop: () => Promise<TimeEntry>;
  /** Re-fetch the running timer from the server. */
  refresh: () => Promise<void>;
}

const TimerContext = createContext<TimerContextValue | null>(null);

function elapsedFrom(entry: TimeEntry | null): number {
  if (!entry) return 0;
  const start = new Date(entry.startedAt).getTime();
  if (Number.isNaN(start)) return 0;
  return Math.max(0, Math.floor((Date.now() - start) / 1000));
}

export function TimerProvider({ children }: { children: React.ReactNode }) {
  const [running, setRunning] = useState<TimeEntry | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [loading, setLoading] = useState(true);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const entry = await getRunningTimer();
      setRunning(entry);
      setElapsedSeconds(elapsedFrom(entry));
    } catch {
      // Auth/network failures shouldn't crash the chrome — leave last state.
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Re-sync when the active workspace changes (the timer is per-workspace).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === WORKSPACE_STORAGE_KEY) {
        setLoading(true);
        void refresh();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [refresh]);

  // Local 1s tick + periodic server reconcile (every 60s) while running.
  useEffect(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (!running) return;

    let ticks = 0;
    tickRef.current = setInterval(() => {
      ticks += 1;
      setElapsedSeconds(elapsedFrom(running));
      // Light reconcile once a minute so a stop/start from another tab or
      // device eventually reflects here without hammering the API.
      if (ticks % 60 === 0) void refresh();
    }, 1000);

    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
    };
  }, [running, refresh]);

  const start = useCallback(async (input: StartTimerInput) => {
    const entry = await apiStartTimer(input);
    setRunning(entry);
    setElapsedSeconds(elapsedFrom(entry));
    setLoading(false);
    return entry;
  }, []);

  const stop = useCallback(async () => {
    const entry = await apiStopTimer();
    setRunning(null);
    setElapsedSeconds(0);
    return entry;
  }, []);

  return (
    <TimerContext.Provider
      value={{ running, elapsedSeconds, loading, start, stop, refresh }}
    >
      {children}
    </TimerContext.Provider>
  );
}

export function useTimer(): TimerContextValue {
  const ctx = useContext(TimerContext);
  if (!ctx) {
    throw new Error("useTimer must be used within a TimerProvider");
  }
  return ctx;
}
