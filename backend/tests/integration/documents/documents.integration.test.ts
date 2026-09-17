import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaClient, User, UserRole } from '@prisma/client';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { MembershipService } from '../../../src/common/workspace/membership.service';
import { WorkspaceContextService } from '../../../src/common/workspace/workspace-context.service';
import { ProjectOpsTools, buildVisibilityFilter } from '../../../src/mcp/mcp.tools';
import { MinioService } from '../../../src/documents/minio.service';
const suite =
  process.env.DOCUMENT_PROOF_ADMIN_URL && process.env.DOCUMENT_PROOF_APP_URL
    ? describe
    : describe.skip;
suite('Document UUID CRUD, workspace RLS and signed object bytes', () => {
  let admin: PrismaClient, db: PrismaService, ws: WorkspaceContextService, minio: MinioService;
  let owner: User, staff: User, outsider: User, client: User;
  const a = randomUUID(),
    b = randomUUID(),
    project = randomUUID();
  const toolsFor = (user: User) =>
    new ProjectOpsTools(db, minio, console as any, undefined, undefined, null, ws);
  beforeAll(async () => {
    admin = new PrismaClient({
      datasources: { db: { url: process.env.DOCUMENT_PROOF_ADMIN_URL! } },
    });
    process.env.DATABASE_URL = process.env.DOCUMENT_PROOF_APP_URL;
    db = new PrismaService();
    const config = new ConfigService({
      PROJECT_OPS_TENANCY_ENABLED: 'true',
      MINIO_ENDPOINT: '127.0.0.1',
      MINIO_PORT: '55520',
      MINIO_PUBLIC_ENDPOINT: 'localhost',
      MINIO_PUBLIC_PORT: '55520',
      MINIO_ACCESS_KEY: 'proofuser',
      MINIO_SECRET_KEY: 'proofpassword',
      MINIO_BUCKET_NAME: 'document-proof',
    });
    ws = new WorkspaceContextService(config, db, new MembershipService(db, config));
    minio = new MinioService(config);
    await minio.onModuleInit();
    await admin.workspace.createMany({
      data: [
        { id: a, slug: a, displayName: 'A' },
        { id: b, slug: b, displayName: 'B' },
      ],
    });
    const makeUser = async (role: UserRole, workspaceId: string) => {
      const id = randomUUID();
      const user = await admin.user.create({
        data: {
          id,
          email: `${id}@example.invalid`,
          username: id,
          firstName: 'Proof',
          lastName: role,
          role,
          keycloakId: id,
        },
      });
      await admin.membership.create({
        data: { userKey: id, workspaceId, role: 'OWNER', isDefault: true },
      });
      return user;
    };
    owner = await makeUser('ADMIN', a);
    staff = await makeUser('STAFF', a);
    outsider = await makeUser('ADMIN', b);
    client = await makeUser('CLIENT', a);
    await admin.project.create({
      data: {
        id: project,
        workspaceId: a,
        projectNumber: 'PROOF-1',
        title: 'Proof',
        clientName: 'Proof',
        createdById: owner.id,
      },
    });
    const roles = await db.$queryRaw<
      any[]
    >`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname=current_user`;
    expect(roles[0]).toEqual({ rolbypassrls: false, rolsuper: false });
  });
  afterAll(async () => {
    await admin.project.deleteMany({ where: { id: project } });
    await admin.user.deleteMany({
      where: { id: { in: [owner, staff, outsider, client].filter(Boolean).map((u) => u.id) } },
    });
    await admin.workspace.deleteMany({ where: { id: { in: [a, b] } } });
    await db.$disconnect();
    await admin.$disconnect();
  });
  it('reproduces pruned empty ADMIN OR and fixes full UUID read/update/delete without bypassing tenants', async () => {
    const tools = toolsFor(owner);
    const uploaded: any = await tools.uploadDocument(owner, {
      projectId: project,
      fileName: 'proof.txt',
      mimeType: 'text/plain',
      content: 'document proof bytes',
    });
    const id = uploaded.document.id;
    expect(id).toMatch(/^[a-f0-9-]{36}$/);
    const old = await ws.runForUser(owner, (tx) =>
      tx.document.findFirst({
        where: { id, OR: [{ project: buildVisibilityFilter(owner) }, { projectId: null }] },
      }),
    );
    expect(old).toBeNull();
    const content: any = await tools.getDocumentContent(owner, { documentId: id });
    expect(content.content).toBe('document proof bytes');
    const response = await fetch(content.downloadUrl);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('document proof bytes');
    for (const user of [staff, outsider, client]) {
      await expect(toolsFor(user).getDocumentContent(user, { documentId: id })).rejects.toThrow();
      await expect(
        toolsFor(user).updateDocument(user, { documentId: id, fileName: 'forbidden' }),
      ).rejects.toThrow();
      await expect(toolsFor(user).deleteDocument(user, { documentId: id })).rejects.toThrow();
    }
    await expect(
      toolsFor(client).listProjectDocuments(client, { projectId: project }),
    ).rejects.toThrow();
    // Assigned staff retain their established project access.
    await admin.project.update({ where: { id: project }, data: { assignedToId: staff.id } });
    expect(
      ((await toolsFor(staff).getDocumentContent(staff, { documentId: id })) as any).content,
    ).toBe('document proof bytes');
    await toolsFor(staff).updateDocument(staff, { documentId: id, description: 'staff edit' });
    const updated = await tools.updateDocument(owner, { documentId: id, fileName: 'renamed.txt' });
    expect(updated.document.fileName).toBe('renamed.txt');
    await tools.deleteDocument(owner, { documentId: id });
    await expect(tools.getDocumentContent(owner, { documentId: id })).rejects.toThrow();
    expect((await fetch(content.downloadUrl)).status).toBe(404);
  });
  it('signs public PUT and GET without URL host rewriting', async () => {
    const key = `proof-${randomUUID()}`;
    const put = await minio.getPresignedUploadUrl(key);
    expect(new URL(put).hostname).toBe('localhost');
    expect((await fetch(put, { method: 'PUT', body: 'signed byte roundtrip' })).status).toBe(200);
    const get = await minio.getPresignedDownloadUrl(key);
    const res = await fetch(get);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('signed byte roundtrip');
    // Regression witness: a post-signing host substitution is rejected.
    expect((await fetch(get.replace('localhost', '127.0.0.1'))).status).toBe(403);
    await minio.deleteObject(key);
  });
});
