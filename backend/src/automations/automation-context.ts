import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';

/**
 * LOOP GUARD (per [task §2]).
 *
 * Automation actions that mutate tasks (set_status / assign_task / create_task)
 * go through TasksService, which itself EMITS `task.*` domain events. Those
 * events re-enter the AutomationsListener and could re-trigger rules forever
 * (rule A sets status -> emits task.status_changed -> rule A fires again ...),
 * or two rules could ping-pong.
 *
 * Approach: an AsyncLocalStorage "automation chain" context carrying the current
 * recursion `depth`. When the listener decides to run a rule's actions, it wraps
 * the action execution in `runInChain(depth + 1, ...)`. Because TasksService
 * emits its events synchronously inside that same call (the emit happens before
 * the awaited DB work returns, within the ALS-propagated async context), the
 * re-entrant listener invocation sees the incremented depth via `currentDepth()`
 * and refuses to run once `depth >= maxDepth` (default 1 = a rule's actions may
 * fire, but the events THEY cause will not trigger another generation of rules).
 *
 * Why ALS (not just a payload flag): the emitting services (tasks/projects) are
 * NOT edited to thread an "automated" flag through every event (strict file
 * ownership; and it would be fragile). ALS propagates the marker across the
 * async action call automatically without touching those modules. We ALSO stamp
 * `__automation.depth` onto events we emit ourselves (create_task path), as a
 * belt-and-suspenders signal for any boundary ALS can't span (e.g. an event
 * dispatched on a deferred tick). The listener honors whichever is higher.
 *
 * `maxDepth` is configurable via AUTOMATION_MAX_DEPTH (default 1).
 */
interface AutomationChain {
  depth: number;
}

@Injectable()
export class AutomationContext {
  private readonly als = new AsyncLocalStorage<AutomationChain>();

  /** Current automation recursion depth (0 == not inside any automation chain). */
  currentDepth(): number {
    return this.als.getStore()?.depth ?? 0;
  }

  /** Run `fn` inside an automation chain at the given depth. */
  runInChain<T>(depth: number, fn: () => Promise<T>): Promise<T> {
    return this.als.run({ depth }, fn);
  }
}
