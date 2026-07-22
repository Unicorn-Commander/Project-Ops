/**
 * Public barrel for the git-forge design scaffold.
 * Safe to import types from other modules; do not assume AppModule registration.
 */

export * from './types';
export * from './git-forge.provider';
export { ForgejoAdapter } from './providers/forgejo.adapter';
export { GitForgeModule } from './git-forge.module';
