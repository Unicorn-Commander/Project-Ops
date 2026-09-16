import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { KeycloakStrategy } from './strategies/keycloak.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PatManagementGuard } from './guards/pat-management.guard';
import { PatController } from './pat/pat.controller';
import { PatService } from './pat/pat.service';
import { MembershipService } from '../common/workspace/membership.service';
import { UsersModule } from '../users/users.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    forwardRef(() => UsersModule),
    EmailModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.get('JWT_EXPIRES_IN', '1d'),
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController, PatController],
  providers: [
    AuthService,
    JwtStrategy,
    KeycloakStrategy,
    JwtAuthGuard,
    PatManagementGuard,
    PatService,
    MembershipService,
  ],
  exports: [AuthService, JwtModule, PatService, JwtAuthGuard],
})
export class AuthModule {}
