/**
 * Client-portal component library.
 *
 * Hospitable, calm building blocks for the surface a customer's clients log in
 * to. Distinct from the dense staff app: more breathing room, a warm branded
 * hero, friendly empty states, and a first-run welcome. Pages under
 * app/client-portal/** compose these.
 */

export { PortalHeader } from "./portal-header";
export type { PortalHeaderProps } from "./portal-header";

export { PortalPageHeader } from "./portal-page-header";
export type { PortalPageHeaderProps } from "./portal-page-header";

export { StatCard } from "./stat-card";
export type { StatCardProps } from "./stat-card";

export { PortalEmpty } from "./portal-empty";
export type { PortalEmptyProps } from "./portal-empty";

export { PortalWelcome } from "./portal-welcome";
export type { PortalWelcomeProps } from "./portal-welcome";

export { money, formatFileSize } from "./portal-utils";
