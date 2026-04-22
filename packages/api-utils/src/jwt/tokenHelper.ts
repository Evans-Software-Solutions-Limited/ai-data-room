import { t, type Static } from "elysia";

import { unpackJWT } from "./unpackJWT";

const BEARER_PREFIX = "Bearer ";

// Schema retained for future validation - used in type derivation
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- used in Static<typeof tokenPayloadSchema>
const tokenPayloadSchema = t.Object({
  // 'custom:blc_old_id': t.String(),
  // 'custom:blc_old_uuid': t.String(),
  // card_status: t.String(),
});

type TokenPayload = Static<typeof tokenPayloadSchema>;

export class TokenHelper {
  /**
   * Returns the token without the Bearer prefix
   */
  static removeBearerPrefix(authorizationHeader: string): string {
    if (authorizationHeader.startsWith(BEARER_PREFIX)) {
      return authorizationHeader.substring(BEARER_PREFIX.length);
    } else {
      // If no Bearer prefix, assume the full header is the token
      return authorizationHeader;
    }
  }

  static extractDataFromToken(token: string): TokenPayload {
    const decodedToken = unpackJWT(token);
    return decodedToken as TokenPayload;
  }

  /**
   * Extracts the data from the token without any validation
   *
   * **SAFETY**
   *
   * This method does not validate the token. It should only be used in contexts
   * where the token is already known to be valid, or where the token does not
   * need to be validated.
   *
   * Additionally, this method type casts the resulting data to a JSON value
   * type. It should therefore only be used when the token is known to encode
   * JSON data.
   */
  static unsafeExtractDataFromToken(token: string) {
    return unpackJWT(token);
  }
}
