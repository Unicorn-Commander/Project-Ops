import { PrismaClient, UserRole, OrgType, ProjectStatus, ProjectPriority } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding Project Ops database...');

  // Create admin user - Aaron Stransky
  const adminPassword = await bcrypt.hash('ProjectOps2026!', 10);
  const aaron = await prisma.user.upsert({
    where: { email: 'aaron@magicunicorn.tech' },
    update: {},
    create: {
      email: 'aaron@magicunicorn.tech',
      username: 'aaron',
      firstName: 'Aaron',
      lastName: 'Stransky',
      role: UserRole.ADMIN,
      password: adminPassword,
      isActive: true,
    },
  });
  console.log('Created admin user:', aaron.email);

  // Create manager user - Shafen Khan
  const managerPassword = await bcrypt.hash('ProjectOps2026!', 10);
  const shafen = await prisma.user.upsert({
    where: { email: 'shafenkhan@users.noreply.github.com' },
    update: {},
    create: {
      email: 'shafenkhan@users.noreply.github.com',
      username: 'shafen',
      firstName: 'Shafen',
      lastName: 'Khan',
      role: UserRole.MANAGER,
      password: managerPassword,
      isActive: true,
    },
  });
  console.log('Created manager user:', shafen.email);

  // Create Magic Unicorn organization
  const magicUnicorn = await prisma.organization.upsert({
    where: { id: 'magic-unicorn-org' },
    update: {},
    create: {
      id: 'magic-unicorn-org',
      name: 'Magic Unicorn',
      type: OrgType.AGENCY,
      industry: 'Technology & Creative Services',
      website: 'https://magicunicorn.tech',
      address: '',
      city: '',
      state: '',
      zipCode: '',
      country: 'USA',
      portalAccessEnabled: true,
      isActive: true,
      createdById: aaron.id,
    },
  });
  console.log('Created organization:', magicUnicorn.name);

  // Create seed projects
  const project1 = await prisma.project.create({
    data: {
      projectNumber: 'PROJ-001',
      title: 'Majiks Studio Launch',
      description: 'Launch campaign and deliverables for Majiks Studio brand. Includes website, social media assets, and marketing collateral.',
      status: ProjectStatus.IN_PROGRESS,
      priority: ProjectPriority.HIGH,
      category: 'MARKETING',
      clientName: 'Magic Unicorn',
      clientEmail: 'aaron@magicunicorn.tech',
      dueDate: new Date('2026-04-09'),
      createdById: aaron.id,
      assignedToId: shafen.id,
      organizationId: magicUnicorn.id,
      tags: ['launch', 'branding', 'marketing'],
    },
  });
  console.log('Created project:', project1.title);

  const project2 = await prisma.project.create({
    data: {
      projectNumber: 'PROJ-002',
      title: 'Client Portal Platform',
      description: 'Ongoing client work - client portal platform maintenance and feature development.',
      status: ProjectStatus.IN_PROGRESS,
      priority: ProjectPriority.MEDIUM,
      category: 'CLIENT_WORK',
      clientName: 'Acme Corp',
      createdById: aaron.id,
      assignedToId: aaron.id,
      organizationId: magicUnicorn.id,
      tags: ['client-work', 'development', 'ongoing'],
    },
  });
  console.log('Created project:', project2.title);

  const project3 = await prisma.project.create({
    data: {
      projectNumber: 'PROJ-003',
      title: 'Project Ops Refactor',
      description: 'Internal project - building Project Ops general-purpose PM/CRM platform.',
      status: ProjectStatus.NEW,
      priority: ProjectPriority.HIGH,
      category: 'INTERNAL',
      clientName: 'Magic Unicorn',
      clientEmail: 'aaron@magicunicorn.tech',
      createdById: aaron.id,
      assignedToId: aaron.id,
      organizationId: magicUnicorn.id,
      tags: ['internal', 'development', 'refactor'],
    },
  });
  console.log('Created project:', project3.title);

  console.log('Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
