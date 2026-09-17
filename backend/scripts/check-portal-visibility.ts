import 'reflect-metadata';
import { strict as assert } from 'assert';
import { PrismaClient } from '@prisma/client';
import { ClientPortalService } from '../src/client-portal/client-portal.service';
import { DocumentsService } from '../src/documents/documents.service';

async function main() {
  if (!process.env.DATABASE_URL?.includes('127.0.0.1:55489/portal_test'))
    throw new Error('Throwaway DB only');
  const db = new PrismaClient();
  const context = { runForUser: (_u: any, fn: any) => db.$transaction((tx) => fn(tx)) };
  const audit = { log: async () => undefined };
  let reads = 0;
  const minio = {
    getPresignedDownloadUrl: async () => {
      reads++;
      return 'signed-approved';
    },
    getObjectStream: async () => {
      reads++;
      return 'approved-bytes';
    },
  };
  const portal = new ClientPortalService(
    context as any,
    audit as any,
    { emit: () => true } as any,
    {} as any,
  );
  const docs = new DocumentsService(db as any, minio as any, audit as any, context as any);
  try {
    const client = await db.user.create({
      data: {
        username: 'client',
        email: 'client@example.test',
        firstName: 'Test',
        lastName: 'Client',
        role: 'CLIENT',
      },
    });
    const other = await db.user.create({
      data: {
        username: 'other',
        email: 'other@example.test',
        firstName: 'Other',
        lastName: 'Client',
        role: 'CLIENT',
      },
    });
    const staff = await db.user.create({
      data: {
        username: 'staff',
        email: 'staff@example.test',
        firstName: 'Test',
        lastName: 'Staff',
        role: 'ADMIN',
      },
    });
    const contact = await db.contact.create({
      data: {
        workspaceId: 'ws-A',
        userId: client.id,
        firstName: 'Test',
        lastName: 'Client',
        email: client.email,
        portalAccessEnabled: true,
        createdById: staff.id,
      },
    });
    const otherContact = await db.contact.create({
      data: {
        workspaceId: 'ws-A',
        userId: other.id,
        firstName: 'Other',
        lastName: 'Client',
        email: other.email,
        portalAccessEnabled: true,
        createdById: staff.id,
      },
    });
    const project = await db.project.create({
      data: {
        workspaceId: 'ws-A',
        projectNumber: 'P-1',
        title: 'Client project',
        clientName: 'Test',
        description: 'SECRET INTERNAL TERMS',
        clientDescription: 'Approved progress',
        contactId: contact.id,
        createdById: staff.id,
      },
    });
    const otherProject = await db.project.create({
      data: {
        workspaceId: 'ws-A',
        projectNumber: 'P-2',
        title: 'Other client',
        clientName: 'Other',
        contactId: otherContact.id,
        createdById: staff.id,
      },
    });
    const foreign = await db.project.create({
      data: {
        workspaceId: 'ws-B',
        projectNumber: 'P-3',
        title: 'Other tenant',
        clientName: 'Foreign',
        contactId: contact.id,
        createdById: staff.id,
      },
    });
    const mkdoc = (id: string, projectId: string, workspaceId: string, visible?: boolean) =>
      db.document.create({
        data: {
          id,
          workspaceId,
          projectId,
          uploadedById: staff.id,
          fileName: id + '.txt',
          fileSize: 12,
          mimeType: 'text/plain',
          s3Key: 'secret-key-' + id,
          s3Bucket: 'bucket',
          status: 'UPLOADED',
          isClientVisible: visible,
          tags: [],
          metadata: { secret: 'internal metadata' },
        },
      });
    await mkdoc('approved', project.id, 'ws-A', true);
    const internal = await mkdoc('internal', project.id, 'ws-A');
    assert.equal(internal.isClientVisible, false, 'existing/new docs default private');
    await mkdoc('other', otherProject.id, 'ws-A', true);
    await mkdoc('foreign', foreign.id, 'ws-B', true);
    await db.comment.create({
      data: {
        workspaceId: 'ws-A',
        projectId: project.id,
        authorId: staff.id,
        content: 'SECRET STAFF COMMENT',
        isInternal: true,
      },
    });
    await db.comment.create({
      data: {
        workspaceId: 'ws-A',
        projectId: project.id,
        authorId: staff.id,
        content: 'Approved recap',
        isInternal: false,
      },
    });
    const details = await portal.getProjectDetails('ws-A', client, project.id);
    assert.equal(details.description, 'Approved progress');
    assert.deepEqual(
      details.documents.map((d) => d.id),
      ['approved'],
    );
    assert.equal(details.comments.length, 1);
    assert.ok(!JSON.stringify(details).includes('SECRET'));
    assert.equal((await portal.getProjects('ws-A', client))[0].description, 'Approved progress');
    assert.equal((await portal.getDashboard('ws-A', client)).documentsCount, 1);
    assert.deepEqual(
      (await portal.getDocuments('ws-A', client)).map((d) => d.id),
      ['approved'],
    );
    assert.ok(!JSON.stringify(await portal.getDocuments('ws-A', client)).includes('secret-key'));
    assert.deepEqual(
      (await docs.findAll('ws-A', client)).documents.map((d) => d.id),
      ['approved'],
    );
    assert.equal((await docs.findByProjectId('ws-A', client, otherProject.id)).length, 0);
    assert.ok(!JSON.stringify(await docs.findOne('ws-A', client, 'approved')).includes('secret'));
    assert.equal(
      await docs.generatePresignedDownloadUrl('ws-A', client, 'approved'),
      'signed-approved',
    );
    assert.equal(
      (await docs.downloadFileProxy('ws-A', client, 'approved')).stream,
      'approved-bytes',
    );
    const before = reads;
    for (const id of ['internal', 'other', 'foreign', 'missing']) {
      await assert.rejects(docs.findOne('ws-A', client, id));
      await assert.rejects(docs.generatePresignedDownloadUrl('ws-A', client, id));
      await assert.rejects(docs.downloadFileProxy('ws-A', client, id));
    }
    assert.equal(reads, before, 'denied callers never reach object storage');
    await assert.rejects(portal.getProjectDetails('ws-A', client, otherProject.id));
    await assert.rejects(portal.getProjectDetails('ws-A', client, foreign.id));
    await assert.rejects(portal.getProjectDetails('ws-B', client, foreign.id));
    assert.equal((await docs.findOne('ws-A', staff, 'internal')).id, 'internal');
    await db.project.update({ where: { id: project.id }, data: { clientDescription: null } });
    assert.equal((await portal.getProjectDetails('ws-A', client, project.id)).description, null);
    await db.contact.update({ where: { id: contact.id }, data: { portalAccessEnabled: false } });
    await assert.rejects(portal.getDocuments('ws-A', client));
    await assert.rejects(docs.downloadFileProxy('ws-A', client, 'approved'));
    assert.equal((await docs.findAll('ws-A', client)).documents.length, 0);
    console.log(
      'PASS: real PostgreSQL portal approved content, default privacy, disabled portal, cross-contact/workspace denial, direct metadata/download and storage-call isolation; staff preserved.',
    );
  } finally {
    await db.$disconnect();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
