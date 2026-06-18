import type { WorkspaceTxClient } from '../prisma/prisma.service';

/**
 * Tasks-side contract for the CustomFieldsService that the CustomFieldsModule
 * provides (see ../custom-fields/custom-fields.service). The tasks module
 * consumes it through Nest DI rather than a hard import so that:
 *   - the tasks code compiles + tests run before that module lands, and
 *   - the dependency is optional/inert until the integrator wires it.
 *
 * The integrator binds the real CustomFieldsService to the CUSTOM_FIELDS_SERVICE
 * token in the module wiring, e.g.
 *
 *   import { CustomFieldsService } from '../custom-fields/custom-fields.service';
 *   providers: [
 *     CustomFieldsService,
 *     { provide: CUSTOM_FIELDS_SERVICE, useExisting: CustomFieldsService },
 *   ]
 *
 * The runtime contract is EXACTLY:
 *   validateValues(tx, workspaceId, 'TASK', incoming) => Promise<Record<string, any>>
 * which validates `incoming` against the workspace's TASK custom-field
 * definitions and returns the normalized values to persist.
 */
export const CUSTOM_FIELDS_SERVICE = 'CUSTOM_FIELDS_SERVICE';

/** Entity discriminator for custom-field definitions (mirrors CustomFieldEntity). */
export type CustomFieldEntity = 'TASK' | 'PROJECT';

/**
 * The single method the tasks module needs: validate + normalize a bag of
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
