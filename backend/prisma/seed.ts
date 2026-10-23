// Demo users and shared passwords are intentionally not seeded.
// The interactive self-host bootstrap creates exactly one local owner.
import { bootstrapAdmin } from '../src/selfhost/bootstrap';

if (process.env.PROJECT_OPS_SELFHOST_CONFIG) {
  bootstrapAdmin().catch(() => {
    console.error('Bootstrap failed; use the interactive self-host command in README.md');
    process.exitCode = 1;
  });
} else {
  console.log('No demo users seeded. Use the self-host bootstrap documented in README.md.');
}
