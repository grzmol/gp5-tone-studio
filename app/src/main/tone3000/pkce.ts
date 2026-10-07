import { createHash, randomBytes } from "node:crypto";

/** base64url without padding (RFC 7636 Appendix A). */
export function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** code_challenge for the S256 method: BASE64URL(SHA256(ASCII(code_verifier))). */
export function codeChallenge(verifier: string): string {
  return base64url(createHash("sha256").update(verifier, "ascii").digest());
}

/** A fresh PKCE pair (43-char verifier from 32 random bytes) and an unguessable `state`. */
export function createPkce(): { verifier: string; challenge: string; state: string } {
  const verifier = base64url(randomBytes(32));
  return { verifier, challenge: codeChallenge(verifier), state: base64url(randomBytes(16)) };
}
