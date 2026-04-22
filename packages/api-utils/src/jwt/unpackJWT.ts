import { jwtDecode } from "jwt-decode";

/*
 * This function will need to be updated to support our specific JWT structure.
 */

export type JWT = Record<string, unknown>;

export function unpackJWT(jwt: string): JWT {
  try {
    const decodedToken = jwtDecode(jwt);
    return decodedToken as JWT;
  } catch (error) {
    console.error("Error decoding token", error);
    throw error;
  }
}
