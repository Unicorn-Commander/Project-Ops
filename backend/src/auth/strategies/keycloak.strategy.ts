import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-oauth2';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service';

@Injectable()
export class KeycloakStrategy extends PassportStrategy(Strategy, 'keycloak') {
  private readonly logger = new Logger(KeycloakStrategy.name);
  private readonly userinfoURL: string;

  constructor(
    private configService: ConfigService,
    private authService: AuthService,
  ) {
    const keycloakUrl = configService.get('KEYCLOAK_URL', 'http://uchub-keycloak:8080');
    const realm = configService.get('KEYCLOAK_REALM', 'uchub');
    const callbackURL = configService.get(
      'KEYCLOAK_CALLBACK_URL',
      '/api/v1/auth/keycloak/callback',
    );

    super({
      authorizationURL: `${keycloakUrl}/realms/${realm}/protocol/openid-connect/auth`,
      tokenURL: `${keycloakUrl}/realms/${realm}/protocol/openid-connect/token`,
      clientID: configService.get('KEYCLOAK_CLIENT_ID'),
      clientSecret: configService.get('KEYCLOAK_CLIENT_SECRET'),
      callbackURL,
      scope: ['openid', 'profile', 'email'],
    });

    this.userinfoURL = `${keycloakUrl}/realms/${realm}/protocol/openid-connect/userinfo`;
  }

  async validate(accessToken: string, refreshToken: string, profile: any): Promise<any> {
    // passport-oauth2 does not fetch userinfo automatically,
    // so we call the Keycloak userinfo endpoint to get the full profile.
    let userProfile = profile;

    try {
      const response = await fetch(this.userinfoURL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (response.ok) {
        userProfile = await response.json();
      } else {
        this.logger.warn(
          `Failed to fetch userinfo from Keycloak: ${response.status} ${response.statusText}`,
        );
      }
    } catch (error) {
      this.logger.error('Error fetching Keycloak userinfo', error);
    }

    const keycloakId = userProfile.sub || userProfile.id;
    // Forward this login's uchub access token so the (optional) Ops-Center
    // entitlements gate can verify the org's Project-Ops entitlement. This is
    // the interactive SSO login, so the token is a real uchub Bearer; the gate
    // is re-checked here on every login. Harmless when the gate is unarmed.
    const user = await this.authService.validateKeycloakUser(keycloakId, userProfile, accessToken);

    return user;
  }
}
