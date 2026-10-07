import { HostError } from "@shared/ipc";

export interface TokenSet {
  access_token: string;
  refresh_token: string;
  /** Unix ms when the access token expires */
  expires_at: number;
}

/** Token endpoint response (https://www.tone3000.com/api › Session). */
export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type?: string;
}

export interface TokenStore {
  load(): Promise<TokenSet | null>;
  save(tokens: TokenSet): Promise<void>;
  clear(): Promise<void>;
}

/** Thrown by the refresh call when TONE3000 rejects the refresh token (400 invalid_grant). */
export class InvalidGrantError extends Error {
  constructor() {
    super("invalid_grant");
    this.name = "InvalidGrantError";
  }
}

export function toTokenSet(res: TokenResponse, now: number, previous?: TokenSet | null): TokenSet {
  if (!res.access_token || typeof res.expires_in !== "number") throw new HostError("network", "TONE3000 sent an unexpected token response");
  const refresh = res.refresh_token ?? previous?.refresh_token;
  if (!refresh) throw new HostError("network", "TONE3000 sent no refresh token");
  return { access_token: res.access_token, refresh_token: refresh, expires_at: now + res.expires_in * 1000 };
}

/**
 * Holds the TONE3000 session: refreshes proactively before expiry (skew), shares one in-flight refresh
 * between concurrent callers, keeps tokens on network failures and drops them on invalid_grant.
 */
export class TokenManager {
  private cached: TokenSet | null | undefined;
  private refreshing: Promise<TokenSet> | null = null;
  /** Set when the last refresh was rejected; cleared by a new sign-in */
  expired = false;

  constructor(
    private store: TokenStore,
    private refreshFn: (refreshToken: string) => Promise<TokenResponse>,
    private now: () => number = Date.now,
    private skewMs = 60_000,
  ) {}

  private async current(): Promise<TokenSet | null> {
    if (this.cached === undefined) this.cached = await this.store.load();
    return this.cached;
  }

  async signedIn(): Promise<boolean> {
    return (await this.current()) !== null;
  }

  async set(res: TokenResponse): Promise<void> {
    const tokens = toTokenSet(res, this.now(), null);
    this.cached = tokens;
    this.expired = false;
    await this.store.save(tokens);
  }

  async clear(): Promise<void> {
    this.cached = null;
    this.refreshing = null;
    await this.store.clear();
  }

  /** A valid access token, refreshed if it expires within the skew window. */
  async accessToken(): Promise<string> {
    const tokens = await this.current();
    if (!tokens) throw new HostError("unauthorized", "Sign in to TONE3000 first");
    if (tokens.expires_at - this.skewMs > this.now()) return tokens.access_token;
    return (await this.refresh(tokens)).access_token;
  }

  /** Force a refresh (after a 401 on a token we believed valid). */
  async forceRefresh(): Promise<string> {
    const tokens = await this.current();
    if (!tokens) throw new HostError("unauthorized", "Sign in to TONE3000 first");
    return (await this.refresh(tokens)).access_token;
  }

  private refresh(tokens: TokenSet): Promise<TokenSet> {
    this.refreshing ??= (async () => {
      try {
        const res = await this.refreshFn(tokens.refresh_token);
        const next = toTokenSet(res, this.now(), tokens);
        this.cached = next;
        await this.store.save(next);
        return next;
      } catch (e) {
        if (e instanceof InvalidGrantError) {
          this.expired = true;
          await this.clear();
          throw new HostError("unauthorized", "Your TONE3000 sign-in expired. Sign in again.");
        }
        throw e;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }
}
