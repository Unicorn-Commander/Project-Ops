import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { ContactsService } from './contacts.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { InviteContactDto } from './dto/invite-contact.dto';
import { ContactFiltersDto } from './dto/contact-filters.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Contacts')
@ApiBearerAuth()
@Controller('contacts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @ApiOperation({ summary: 'Create a new contact' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Contact created successfully',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Contact with this email already exists',
  })
  async create(@Body() createContactDto: CreateContactDto, @CurrentUser() user: any) {
    return this.contactsService.create(createContactDto, user.userId);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF, UserRole.CLIENT)
  @ApiOperation({ summary: 'Get all contacts with filtering and pagination' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Contacts retrieved successfully',
  })
  async findAll(@Query() filters: ContactFiltersDto, @CurrentUser() user: any) {
    return this.contactsService.findAll(filters, user.userId, user.role);
  }

  @Get('stats')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get contact statistics for dashboard' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Contact statistics retrieved successfully',
  })
  async getStats() {
    return this.contactsService.getStats();
  }

  @Get('organization/:organizationId')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @ApiOperation({ summary: 'Get all contacts for a specific organization' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Organization contacts retrieved successfully',
  })
  async findByOrganization(@Param('organizationId') organizationId: string) {
    return this.contactsService.findByOrganization(organizationId);
  }

  @Get('organization/:organizationId/primary')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @ApiOperation({ summary: 'Get the primary contact for an organization' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Primary contact retrieved successfully',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'No primary contact found for this organization',
  })
  async getPrimaryContact(@Param('organizationId') organizationId: string) {
    return this.contactsService.getPrimaryContact(organizationId);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF, UserRole.CLIENT)
  @ApiOperation({ summary: 'Get a contact by ID' })
  @ApiParam({ name: 'id', description: 'Contact ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Contact retrieved successfully',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Contact not found',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'You do not have permission to access this contact',
  })
  async findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.contactsService.findOne(id, user.userId, user.role);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @ApiOperation({ summary: 'Update a contact' })
  @ApiParam({ name: 'id', description: 'Contact ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Contact updated successfully',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Contact not found',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Email already exists',
  })
  async update(
    @Param('id') id: string,
    @Body() updateContactDto: UpdateContactDto,
    @CurrentUser() user: any,
  ) {
    return this.contactsService.update(id, updateContactDto, user.userId, user.role);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a contact' })
  @ApiParam({ name: 'id', description: 'Contact ID' })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'Contact deleted successfully',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Contact not found',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Cannot delete contact with active portal account or primary contact',
  })
  async remove(@Param('id') id: string, @CurrentUser() user: any) {
    await this.contactsService.remove(id, user.userId, user.role);
  }

  @Patch(':id/set-primary')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Set a contact as the primary contact for their organization' })
  @ApiParam({ name: 'id', description: 'Contact ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Contact set as primary successfully',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Contact must belong to an organization to be set as primary',
  })
  async setPrimaryContact(@Param('id') id: string, @CurrentUser() user: any) {
    return this.contactsService.setPrimaryContact(id, user.userId, user.role);
  }

  @Post(':id/invite')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Invite contact to client portal' })
  @ApiParam({ name: 'id', description: 'Contact ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Portal invitation sent successfully',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Contact already has portal access or user with this email exists',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Contact not found',
  })
  async inviteToPortal(
    @Param('id') id: string,
    @Body() inviteDto: InviteContactDto,
    @CurrentUser() user: any,
  ) {
    return this.contactsService.inviteToPortal(id, inviteDto, user.userId);
  }

  @Post(':contactId/link-user/:userId')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Link an existing user account to a contact' })
  @ApiParam({ name: 'contactId', description: 'Contact ID' })
  @ApiParam({ name: 'userId', description: 'User ID to link' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'User linked to contact successfully',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Contact already linked or user already linked to another contact',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Contact or user not found',
  })
  async linkToUser(
    @Param('contactId') contactId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: any,
  ) {
    return this.contactsService.linkToUser(contactId, userId, user.userId);
  }

  @Delete(':id/unlink-user')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Unlink user account from contact' })
  @ApiParam({ name: 'id', description: 'Contact ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'User unlinked from contact successfully',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Contact is not linked to any user account',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Contact not found',
  })
  async unlinkFromUser(@Param('id') id: string, @CurrentUser() user: any) {
    return this.contactsService.unlinkFromUser(id, user.userId);
  }
}
