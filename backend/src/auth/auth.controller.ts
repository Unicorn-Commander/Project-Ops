import { WorkspaceWriteException } from '../common/workspace/workspace-write-policy.decorator';
import { Controller, Post, Body, UseGuards, Get, Req, Res, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ClientSignupDto } from './dto/client-signup.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { SkipWorkspaceMembership } from '../common/workspace/skip-workspace-membership.decorator';
import { User } from '@prisma/client';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('login')
  @Public()
  @SkipWorkspaceMembership()
  @Throttle({ short: { limit: 5, ttl: 60000 } }) // 5 attempts per minute
  @ApiOperation({ summary: 'Login with email/password' })
  @ApiResponse({ status: 200, description: 'Returns JWT token and user info' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 429, description: 'Too many login attempts, please try again later' })
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Get('profile')
  @SkipWorkspaceMembership()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'Returns user profile' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getProfile(@CurrentUser() user: User) {
    return this.authService.getProfile(user);
  }

  @Post('change-password')
  @WorkspaceWriteException('personal')
  @Throttle({ short: { limit: 3, ttl: 3600000 } }) // 3 attempts per hour
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Change own password' })
  @ApiResponse({ status: 200, description: 'Password changed successfully' })
  @ApiResponse({ status: 400, description: 'Password does not meet security requirements' })
  @ApiResponse({ status: 401, description: 'Current password is incorrect' })
  @ApiResponse({ status: 429, description: 'Too many password change attempts' })
  async changePassword(@CurrentUser() user: User, @Body() changePasswordDto: ChangePasswordDto) {
    return this.authService.changePassword(
      user.id,
      changePasswordDto.currentPassword,
      changePasswordDto.newPassword,
    );
  }

  @Get('keycloak')
  @Public()
  @SkipWorkspaceMembership()
  @UseGuards(AuthGuard('keycloak'))
  @ApiOperation({ summary: 'Redirect to Keycloak SSO login (uchub realm)' })
  @ApiResponse({ status: 302, description: 'Redirects to Keycloak login page' })
  async keycloakLogin() {
    // Passport handles the redirect to Keycloak
  }

  @Get('keycloak/callback')
  @Public()
  @SkipWorkspaceMembership()
  @UseGuards(AuthGuard('keycloak'))
  @ApiOperation({ summary: 'Keycloak OAuth callback (uchub realm)' })
  @ApiResponse({ status: 302, description: 'Redirects to frontend with JWT token' })
  async keycloakCallback(@Req() req: any, @Res() res: any) {
    const tokenData = await this.authService.generateTokenForUser(req.user);
    const frontendUrl = this.configService.get<string>(
      'FRONTEND_URL',
      'https://projectops.unicorncommander.ai',
    );

    // Hand the token to the frontend in the URL FRAGMENT. Browsers never send a
    // fragment to any server, so it stays out of proxy access logs and Referer
    // headers, and the analytics tag is told to ignore it. The callback page reads
    // it and strips it from the address bar at once (PO ef606ec9).
    return res.redirect(
      `${frontendUrl}/auth/sso-callback#token=${encodeURIComponent(tokenData.access_token)}`,
    );
  }

  @Post('client-signup/:token')
  @Public()
  @SkipWorkspaceMembership()
  @ApiOperation({ summary: 'Client portal signup with invitation token' })
  @ApiResponse({ status: 201, description: 'Client signup successful, returns JWT token' })
  @ApiResponse({
    status: 400,
    description: 'Invalid request (passwords mismatch, client already signed up)',
  })
  @ApiResponse({ status: 404, description: 'Invalid invitation token' })
  async clientSignup(@Param('token') token: string, @Body() dto: ClientSignupDto) {
    return this.authService.clientSignup(token, dto);
  }
}
