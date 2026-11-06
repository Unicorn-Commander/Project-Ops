export type SigningKey = { getPublicKey: () => string };

export type JwksClient = {
  getSigningKey: (kid: string, callback: (error: Error | null, key?: SigningKey) => void) => void;
};

let publicKey = '';

export function setJwksPublicKey(value: string): void {
  publicKey = value;
}

export default function jwksClient(_options: unknown): JwksClient {
  return {
    getSigningKey: (_kid, callback) => {
      if (!publicKey) {
        callback(new Error('test JWKS public key is not configured'));
        return;
      }
      callback(null, { getPublicKey: () => publicKey });
    },
  };
}
