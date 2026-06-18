import type { WorkspaceTxClient } from '../prisma/prisma.service';

/**
 * Projects-side contract for the CustomFieldsService that the CustomFieldsModule
 * provides (see ../custom-fields/custom-fields.service). The projects module
 * consumes it through Nest DI rather than a hard import so that:
 *   - the projects code compiles + tests run before that module lands, and
 *   - the dependency is optional/inert until the integrator wires it.
 *
 * Mirrors the tasks-side contract (../tasks/custom-fields.contract.ts) and shares
 * the SAME injection token, so when the integrator binds the real
 * CustomFieldsService once, both the tasks and projects modules resolve it:
 *
 *   import { CustomFieldsService } from '../custom-fields/custom-fields.service';
 *   providers: [
 *     CustomFieldsService,
 *     { provide: CUSTOM_FIELDS_SERVICE, useExisting: CustomFieldsService },
 *   ]
 *
 * The runtime contract is EXACTLY:
 *   validateValues(tx, workspaceId, 'PROJECT', incoming) => Promise<Record<string, any>>
 * which validates `incoming` against the workspace's PROJECT custom-field
 * definitions and returns the normalized values to persist.
 */
export const CUSTOM_FIELDS_SERVICE = 'CUSTOM_FIELDS_SERVICE';

/** Entity discriminator for custom-field definitions (mirrors CustomFieldEntity). */
export type CustomFieldEntity = 'TASK' | 'PROJECT';

/**
 * The single method the projects module needs: validate + normalize a bag of
 * custom-field values for `entity` within `workspaceId`, inside the caller's
 * workspace RLS transaction `tx`. Throws (BadRequestException) on invalid input
 * — e.g. unknown key, wrong type, missing required field, bad SELECT option.
 */
export interface CustomFieldsValidator {
  validateValues(
    tx: WorkspaceTxClient,
    workspaceId: string,
    entity: CustomFieldEntity,
    incoming: Record<string, any>,
  ): Promise<Record<string, any>>;
}
