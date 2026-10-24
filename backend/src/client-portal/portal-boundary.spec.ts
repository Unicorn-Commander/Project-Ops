import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { ProjectsController } from '../projects/projects.controller';
import { ProjectsService } from '../projects/projects.service';
import { TasksController } from '../tasks/tasks.controller';
import { TasksService } from '../tasks/tasks.service';
import { CommentsController } from '../comments/comments.controller';
import { CommentsService } from '../comments/comments.service';
import { DocumentsController } from '../documents/documents.controller';
import { DocumentsService } from '../documents/documents.service';
import { McpController } from '../mcp/mcp.controller';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { McpService } from '../mcp/mcp.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';

describe('Client portal boundary over HTTP', () => {
  let app: INestApplication;
  const internal = {
    findOne: jest.fn(() => ({ description: 'internal' })),
    findAll: jest.fn(() => []),
    update: jest.fn((_w, _u, _id, d) => d),
  };
  const mcp = { createServerForUser: jest.fn() };
  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [
        ProjectsController,
        TasksController,
        CommentsController,
        DocumentsController,
        McpController,
      ],
      providers: [
        ...[ProjectsService, TasksService, CommentsService, DocumentsService].map((provide) => ({
          provide,
          useValue: internal,
        })),
        { provide: McpService, useValue: mcp },
        {
          provide: WorkspaceContextService,
          useValue: { resolveFederationDelegation: async () => ({ kind: 'none' }) },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(WorkspaceMembershipGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = mod.createNestApplication();
    // Fixed local fixture identities; actual JWT/membership integration is a release gate.
    app.use((req: any, _res: any, next: any) => {
      req.user = { id: 'fixture', role: req.headers['x-test-role'] || 'CLIENT' };
      req.workspaceId = 'fixture-ws';
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });
  afterAll(() => app.close());
  it.each(['/projects/private', '/tasks/private', '/comments/private'])(
    '403s CLIENT on internal route %s',
    async (path) => {
      await request(app.getHttpServer()).get(path).expect(403);
    },
  );
  it('403s CLIENT MCP before any tool server is constructed', async () => {
    await request(app.getHttpServer())
      .post('/mcp')
      .send({ method: 'tools/call', params: { name: 'get_project' } })
      .expect(403);
    expect(mcp.createServerForUser).not.toHaveBeenCalled();
  });
  it('denies client document approval', async () => {
    await request(app.getHttpServer())
      .patch('/documents/private')
      .send({ isClientVisible: true })
      .expect(403);
  });
  it('supports validated staff publication through existing APIs', async () => {
    const p = await request(app.getHttpServer())
      .patch('/projects/private')
      .set('x-test-role', 'ADMIN')
      .send({ clientDescription: 'Approved recap' })
      .expect(200);
    expect(p.body.clientDescription).toBe('Approved recap');
    const d = await request(app.getHttpServer())
      .patch('/documents/private')
      .set('x-test-role', 'ADMIN')
      .send({ isClientVisible: true })
      .expect(200);
    expect(d.body.isClientVisible).toBe(true);
    await request(app.getHttpServer())
      .patch('/documents/private')
      .set('x-test-role', 'ADMIN')
      .send({ isClientVisible: 'true' })
      .expect(400);
  });
});
