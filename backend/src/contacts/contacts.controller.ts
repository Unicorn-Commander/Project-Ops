import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ContactsService } from './contacts.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentWorkspace } from '../common/workspace/current-workspace.decorator';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';
import { User, UserRole } from '@prisma/client';

/**
 * Suite tenancy (Phase 2, B6): every route resolves the active workspace via
 * @CurrentWorkspace + WorkspaceMembershipGuard and passes (workspaceId, user)
 * into the service, which runs all DB access inside that workspace's RLS tx.
 */
@ApiTags('contacts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, WorkspaceMembershipGuard)
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @ApiOperation({ summary: 'Create a new contact' })
  @ApiResponse({ status: 201, description: 'Contact created successfully' })
  @ApiResponse({ status: 409, description: 'Contact with email already exists' })
  create(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Body() createContactDto: CreateContactDto,
  ) {
    return this.contactsService.create(workspaceId, user, createContactDto);
  }

  @Get()
  @SkipThrottle({ short: true, long: true })
  @ApiOperation({ summary: 'Get all contacts with pagination and search' })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'List of contacts' })
  findAll(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Query('skip', new DefaultValuePipe(0), ParseIntPipe) skip?: number,
    @Query('take', new DefaultValuePipe(50), ParseIntPipe) take?: number,
    @Query('search') search?: string,
    @Query('isActive') isActive?: string,
  ) {
    const isActiveBoolean =
      isActive === 'true' ? true : isActive === 'false' ? false : undefined;

    return this.contactsService.findAll(workspaceId, user, {
      skip,
      take,
      search,
      isActive: isActiveBoolean,
    });
  }

  @Get('stats')
  @SkipThrottle({ short: true, long: true })
  @ApiOperation({ summary: 'Get contact statistics for dashboard' })
  @ApiResponse({ status: 200, description: 'Contact statistics' })
  getStats(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
  ) {
    return this.contactsService.getContactStats(workspaceId, user);
  }

  @Get(':id')
  @SkipThrottle({ short: true, long: true })
  @ApiOperation({ summary: 'Get contact by ID' })
  @ApiResponse({ status: 200, description: 'Contact details' })
  @ApiResponse({ status: 404, description: 'Contact not found' })
  findOne(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.contactsService.findOne(workspaceId, user, id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @ApiOperation({ summary: 'Update contact' })
  @ApiResponse({ status: 200, description: 'Contact updated successfully' })
  @ApiResponse({ status: 404, description: 'Contact not found' })
  @ApiResponse({ status: 409, description: 'Email already exists' })
  update(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() updateContactDto: UpdateContactDto,
  ) {
    return this.contactsService.update(workspaceId, user, id, updateContactDto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Delete contact (soft delete)' })
  @ApiResponse({ status: 200, description: 'Contact deleted successfully' })
  @ApiResponse({ status: 404, description: 'Contact not found' })
  remove(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.contactsService.remove(workspaceId, user, id);
  }

  @Get(':id/projects')
  @SkipThrottle({ short: true, long: true })
  @ApiOperation({ summary: 'Get all projects for a contact' })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'List of projects for contact' })
  @ApiResponse({ status: 404, description: 'Contact not found' })
  findContactProjects(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Query('skip', new DefaultValuePipe(0), ParseIntPipe) skip?: number,
    @Query('take', new DefaultValuePipe(50), ParseIntPipe) take?: number,
  ) {
    return this.contactsService.findContactProjects(workspaceId, user, id, {
      skip,
      take,
    });
  }

  @Get(':id/billing')
  @SkipThrottle({ short: true, long: true })
  @ApiOperation({ summary: 'Get billing summary for a contact' })
  @ApiResponse({ status: 200, description: 'Billing summary for contact' })
  @ApiResponse({ status: 404, description: 'Contact not found' })
  getContactBilling(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.contactsService.getContactBillingSummary(workspaceId, user, id);
  }

  @Post(':id/invite')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @ApiOperation({ summary: 'Invite contact to portal' })
  @ApiResponse({ status: 200, description: 'Invitation sent successfully' })
  @ApiResponse({ status: 404, description: 'Contact not found' })
  @ApiResponse({ status: 400, description: 'Contact already has portal access' })
  inviteToPortal(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.contactsService.inviteToPortal(workspaceId, user, id);
  }
}
