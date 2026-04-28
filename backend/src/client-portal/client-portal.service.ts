import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UserRole } from '@prisma/client';

@Injectable()
export class ClientPortalService {
  constructor(private prisma: PrismaService) {}

  async getDashboard(userId: string) {
    // Find the contact profile for this user
    const contact = await this.prisma.contact.findUnique({
      where: { userId },
    });

    if (!contact) {
      throw new NotFoundException('Contact profile not found');
    }

    // Get projects count
    const projectsCount = await this.prisma.project.count({
      where: { contactId: contact.id },
    });

    // Get recent projects (5 most recent)
    const recentProjects = await this.prisma.project.findMany({
      where: { contactId: contact.id },
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: {
        assignedTo: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        _count: {
          select: {
            documents: true,
            comments: true,
          },
        },
      },
    });

    // Get documents count
    const documentsCount = await this.prisma.document.count({
      where: {
        project: {
          contactId: contact.id,
        },
      },
    });

    return {
      projectsCount: projectsCount,
      documentsCount,
      recentProjects: recentProjects.map((case_) => ({
        id: case_.id,
        projectNumber: case_.projectNumber,
        title: case_.title,
        status: case_.status,
        priority: case_.priority,
        dueDate: case_.dueDate,
        createdAt: case_.createdAt,
        assignedTo: case_.assignedTo,
        documentsCount: case_._count.documents,
        commentsCount: case_._count.comments,
      })),
    };
  }

  async getProjects(userId: string) {
    // Find the contact profile for this user
    const contact = await this.prisma.contact.findUnique({
      where: { userId },
    });

    if (!contact) {
      throw new NotFoundException('Contact profile not found');
    }

    const projects = await this.prisma.project.findMany({
      where: { contactId: contact.id },
      orderBy: { createdAt: 'desc' },
      include: {
        assignedTo: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        _count: {
          select: {
            documents: true,
            comments: true,
          },
        },
      },
    });

    return projects.map((case_) => ({
      id: case_.id,
      projectNumber: case_.projectNumber,
      title: case_.title,
      description: case_.description,
      status: case_.status,
      priority: case_.priority,
      dueDate: case_.dueDate,
      completedAt: case_.completedAt,
      createdAt: case_.createdAt,
      updatedAt: case_.updatedAt,
      assignedTo: case_.assignedTo,
      documentsCount: case_._count.documents,
      commentsCount: case_._count.comments,
      billingAmount: case_.billingAmount ? parseFloat(case_.billingAmount.toString()) : null,
      amountPaid: case_.amountPaid ? parseFloat(case_.amountPaid.toString()) : null,
      paymentStatus: case_.paymentStatus,
      billingDate: case_.billingDate,
      paymentDueDate: case_.paymentDueDate,
    }));
  }

  async getProjectDetails(userId: string, projectId: string) {
    // Find the contact profile for this user
    const contact = await this.prisma.contact.findUnique({
      where: { userId },
    });

    if (!contact) {
      throw new NotFoundException('Contact profile not found');
    }

    // Get the project with full details
    const case_ = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        assignedTo: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        documents: {
          orderBy: { uploadedAt: 'desc' },
          select: {
            id: true,
            fileName: true,
            fileSize: true,
            mimeType: true,
            status: true,
            description: true,
            uploadedAt: true,
            uploadedBy: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        comments: {
          where: { isInternal: false }, // Only show non-internal comments to clients
          orderBy: { createdAt: 'desc' },
          include: {
            author: {
              select: {
                firstName: true,
                lastName: true,
                role: true,
              },
            },
          },
        },
      },
    });

    if (!case_) {
      throw new NotFoundException('Project not found');
    }

    // Verify ownership - ensure this project belongs to this contact
    if (case_.contactId !== contact.id) {
      throw new ForbiddenException('You do not have access to this project');
    }

    return {
      id: case_.id,
      projectNumber: case_.projectNumber,
      title: case_.title,
      description: case_.description,
      status: case_.status,
      priority: case_.priority,
      dueDate: case_.dueDate,
      completedAt: case_.completedAt,
      createdAt: case_.createdAt,
      updatedAt: case_.updatedAt,
      assignedTo: case_.assignedTo,
      billingAmount: case_.billingAmount ? parseFloat(case_.billingAmount.toString()) : null,
      amountPaid: case_.amountPaid ? parseFloat(case_.amountPaid.toString()) : null,
      paymentStatus: case_.paymentStatus,
      billingDate: case_.billingDate,
      paymentDueDate: case_.paymentDueDate,
      paymentReceivedDate: case_.paymentReceivedDate,
      invoiceNumber: case_.invoiceNumber,
      documents: case_.documents,
      comments: case_.comments,
    };
  }

  async getDocuments(userId: string) {
    // Find the contact profile for this user
    const contact = await this.prisma.contact.findUnique({
      where: { userId },
    });

    if (!contact) {
      throw new NotFoundException('Contact profile not found');
    }

    // Get all documents for projects belonging to this contact
    const documents = await this.prisma.document.findMany({
      where: {
        project: {
          contactId: contact.id,
        },
      },
      orderBy: { uploadedAt: 'desc' },
      include: {
        project: {
          select: {
            id: true,
            projectNumber: true,
            title: true,
          },
        },
        uploadedBy: {
          select: {
            firstName: true,
            lastName: true,
            role: true,
          },
        },
      },
    });

    return documents;
  }
}
