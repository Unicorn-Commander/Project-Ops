import { register } from "node:module";
import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";

// api.ts uses extensionless relative imports (the Next bundler resolves them).
// Node's test runner does not, so append `.ts` for those specifiers only.
const resolveHook = `
export async function resolve(specifier, context, nextResolve) {
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    !/\\.(?:ts|js|mjs|cjs|json|node)$/.test(specifier)
  ) {
    return nextResolve(specifier + ".ts", context);
  }
  return nextResolve(specifier, context);
}
`;
register(
  "data:text/javascript," + encodeURIComponent(resolveHook),
  import.meta.url,
);

const { buildCloneProjectRequest } = await import("./api.ts");

test("clone request uses the clone route and the API defaults", () => {
  const request = buildCloneProjectRequest("proj-1");

  equal(request.url, "/projects/proj-1/clone");
  deepEqual(request.body, {
    includeTasks: true,
    resetStatus: true,
    dueDateMode: "shift",
  });
  equal("headers" in request, false);
});

test("shift clone sends title, target workspace, and a date-only start", () => {
  const request = buildCloneProjectRequest("  proj-1  ", {
    title: "  Launch (copy)  ",
    targetWorkspaceId: " ws-2 ",
    includeTasks: true,
    resetStatus: true,
    dueDateMode: "shift",
    startDate: "2026-11-05",
  });

  equal(request.url, "/projects/proj-1/clone");
  deepEqual(request.body, {
    title: "Launch (copy)",
    targetWorkspaceId: "ws-2",
    includeTasks: true,
    resetStatus: true,
    dueDateMode: "shift",
    startDate: "2026-11-05",
  });
});

test("keep and clear omit startDate; blank title is left for the server default", () => {
  const keep = buildCloneProjectRequest("proj-1", {
    title: "   ",
    dueDateMode: "keep",
    includeTasks: false,
    resetStatus: false,
    startDate: "2026-11-05",
  });
  deepEqual(keep.body, {
    includeTasks: false,
    resetStatus: false,
    dueDateMode: "keep",
  });

  const clear = buildCloneProjectRequest("proj-1", {
    dueDateMode: "clear",
    startDate: "2026-11-05",
  });
  equal("startDate" in clear.body, false);
  equal(clear.body.dueDateMode, "clear");
});

test("clone request rejects an empty project id and an unknown due-date mode", () => {
  throws(() => buildCloneProjectRequest("  "), /projectId is required/);
  throws(
    () =>
      buildCloneProjectRequest("proj-1", {
        dueDateMode: "slide" as "keep",
      }),
    /dueDateMode must be keep, shift, or clear/,
  );
});
