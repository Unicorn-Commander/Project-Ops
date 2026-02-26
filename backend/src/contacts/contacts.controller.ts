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
import { User, UserRole } from '@prisma/client';

@ApiTags('contacts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @ApiOperation({ summary: 'Create a new contact' })
  @ApiResponse({ status: 201, description: 'Contact created successfully' })
  @ApiResponse({ status: 409, description: 'Contact with email already exists' })
  create(@Body() createContactDto: CreateContactDto, @CurrentUser() user: User) {
    return this.contactsService.create(createContactDto, user.id);
  }

  @Get()
  @SkipThrottle()
  @ApiOperation({ summary: 'Get all contacts with pagination and search' })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'List of contacts' })
  findAll(
    @Query('skip', new DefaultValuePipe(0), ParseIntPipe) skip?: number,
    @Query('take', new DefaultValuePipe(50), ParseIntPipe) take?: number,
    @Query('search') search?: string,
    @Query('isActive') isActive?: string,
  ) {
    const isActiveBoolean =
      isActive === 'true' ? true : isActive === 'false' ? false : undefined;

    return this.contactsService.findAll({
      skip,
      take,
      search,
      isActive: isActiveBoolean,
    });
  }

  @Get('stats')
  @SkipThrottle()
  @ApiOperation({ summary: 'Get contact statistics for dashboard' })
  @ApiResponse({ status: 200, description: 'Contact statistics' })
  getStats() {
    return this.contactsService.getContactStats();
  }

  @Get(':id')
  @SkipThrottle()
  @ApiOperation({ summary: 'Get contact by ID' })
  @ApiResponse({ status: 200, description: 'Contact details' })
  @ApiResponse({ status: 404, description: 'Contact not found' })
  findOne(@Param('id') id: string) {
    return this.contactsService.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @ApiOperation({ summary: 'Update contact' })
  @ApiResponse({ status: 200, description: 'Contact updated successfully' })
  @ApiResponse({ status: 404, description: 'Contact not found' })
  @ApiResponse({ status: 409, description: 'Email already exists' })
  update(@Param('id') id: string, @Body() updateContactDto: UpdateContactDto, @CurrentUser() user: User) {
    return this.contactsService.update(id, updateContactDto, user.id);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Delete contact (soft delete)' })
  @ApiResponse({ status: 200, description: 'Contact deleted successfully' })
  @ApiResponse({ status: 404, description: 'Contact not found' })
  remove(@Param('id') id: string, @CurrentUser() user: User) {
    return this.contactsService.remove(id, user.id);
  }

  @Get(':id/projects')
  @SkipThrottle()
  @ApiOperation({ summary: 'Get all projects for a contact' })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'List of projects for contact' })
  @ApiResponse({ status: 404, description: 'Contact not found' })
  findContactProjects(
    @Param('id') id: string,
    @Query('skip', new DefaultValuePipe(0), ParseIntPipe) skip?: number,
    @Query('take', new DefaultValuePipe(50), ParseIntPipe) take?: number,
  ) {
    return this.contactsService.findContactProjects(id, { skip, take });
  }

  @Get(':id/billing')
  @SkipThrottle()
  @ApiOperation({ summary: 'Get billing summary for a contact' })
  @ApiResponse({ status: 200, description: 'Billing summary for contact' })
  @ApiResponse({ status: 404, description: 'Contact not found' })
  getContactBilling(@Param('id') id: string) {
    return this.contactsService.getContactBillingSummary(id);
  }

  @Post(':id/invite')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @ApiOperation({ summary: 'Invite contact to portal' })
  @ApiResponse({ status: 200, description: 'Invitation sent successfully' })
  @ApiResponse({ status: 404, description: 'Contact not found' })
  @ApiResponse({ status: 400, description: 'Contact already has portal access' })
  inviteToPortal(@Param('id') id: string) {
    return this.contactsService.inviteToPortal(id);
  }
}
