import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from '../auth.service';
import { KeycloakStrategy } from './keycloak.strategy';

describe('Keycloak strategy in local mode', () => {
  it('boots without OIDC credentials and refuses redirects/network authentication', () => {
    const config = new ConfigService({ PROJECT_OPS_AUTH_MODE: 'local' });
    const strategy = new KeycloakStrategy(config, {} as AuthService);
    expect(() => strategy.authenticate({} as Request)).toThrow(ServiceUnavailableException);
  });
});
