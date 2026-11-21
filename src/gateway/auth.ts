import type { AuthInfo, VerifyBearerTokenOptions } from "@modelcontextprotocol/server";

import {
  bearerAuthChallengeResponse,
  OAuthError,
  OAuthErrorCode,
  verifyBearerToken,
} from "@modelcontextprotocol/server";
import { createHash, timingSafeEqual } from "node:crypto";

export type AuthResult = { ok: true; authInfo: AuthInfo } | { ok: false; response: Response };

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

// Admits requests that carry the one configured token.
export function createAuthGate(token: string): (request: Request) => Promise<AuthResult> {
  const expected = digest(token);
  const options: VerifyBearerTokenOptions = {
    verifier: {
      verifyAccessToken(candidate) {
        if (!timingSafeEqual(digest(candidate), expected)) {
          return Promise.reject(new OAuthError(OAuthErrorCode.InvalidToken, "Invalid token"));
        }
        return Promise.resolve({
          token: candidate,
          clientId: "agent",
          scopes: [],
          // The SDK refuses tokens that carry no expiry.
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
        });
      },
    },
  };

  return async (request) => {
    try {
      const authInfo = await verifyBearerToken(request.headers.get("authorization"), options);
      return { ok: true, authInfo };
    } catch (error) {
      return { ok: false, response: bearerAuthChallengeResponse(error, options) };
    }
  };
}
