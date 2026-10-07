// TONE3000 REST client (v1). Endpoints and parameters per https://www.tone3000.com/api.
import { HostError } from "@shared/ipc";
import type { T3kModel, T3kTone, T3kUser, ToneListKind } from "@shared/host/tones";
import { InvalidGrantError, type TokenManager, type TokenResponse } from "./tokens";

export const T3K_ORIGIN = "https://www.tone3000.com";
export const PAGE_SIZE = 20;

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

interface Paginated<T> {
  data: T[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

function networkError(e: unknown): HostError {
  if (e instanceof HostError) return e;
  return new HostError("network", "Can't reach TONE3000. Check your connection and try again.");
}

async function failure(res: Response): Promise<HostError> {
  if (res.status === 429) {
    const after = Number(res.headers.get("retry-after"));
    return new HostError("network", `TONE3000 asks us to slow down. Try again in ${Number.isFinite(after) && after > 0 ? Math.ceil(after) : 60} s.`);
  }
  if (res.status === 401) return new HostError("unauthorized", "Your TONE3000 sign-in expired. Sign in again.");
  if (res.status === 403) return new HostError("unauthorized", "TONE3000 doesn't allow this tone for your account.");
  if (res.status === 404) return new HostError("not-found", "This tone isn't on TONE3000 anymore, or it's private.");
  return new HostError("network", `TONE3000 answered ${res.status}. Try again in a moment.`);
}

/** POST /api/v1/oauth/token (form-encoded). Maps 400 invalid_grant to InvalidGrantError. */
export async function postToken(fetchFn: FetchLike, params: Record<string, string>): Promise<TokenResponse> {
  let res: Response;
  try {
    res = await fetchFn(`${T3K_ORIGIN}/api/v1/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    });
  } catch (e) {
    throw networkError(e);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.status === 400 && body.error === "invalid_grant") throw new InvalidGrantError();
    throw new HostError(res.status === 429 ? "network" : "unauthorized", body.error ? `TONE3000 sign-in failed (${body.error})` : `TONE3000 sign-in failed (${res.status})`);
  }
  return (await res.json()) as TokenResponse;
}

export class T3kClient {
  constructor(
    private tokens: TokenManager,
    private fetchFn: FetchLike,
  ) {}

  /** Authenticated request; on 401 refreshes once and retries. */
  async request(url: string, init: RequestInit = {}): Promise<Response> {
    const send = async (token: string) => {
      try {
        return await this.fetchFn(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } });
      } catch (e) {
        throw networkError(e);
      }
    };
    let res = await send(await this.tokens.accessToken());
    if (res.status === 401) res = await send(await this.tokens.forceRefresh());
    if (!res.ok) throw await failure(res);
    return res;
  }

  private async json<T>(path: string): Promise<T> {
    const res = await this.request(`${T3K_ORIGIN}/api/v1${path}`, { headers: { "Content-Type": "application/json" } });
    return (await res.json()) as T;
  }

  user(): Promise<T3kUser> {
    return this.json<T3kUser>("/user");
  }

  async list(kind: ToneListKind, page: number): Promise<{ tones: T3kTone[]; page: number; totalPages: number; total: number }> {
    if (kind === "trending" || kind === "latest") {
      const { data } = await this.json<{ data: T3kTone[] }>(`/tones/${kind}`);
      return { tones: data, page: 1, totalPages: 1, total: data.length };
    }
    const res = await this.json<Paginated<T3kTone>>(`/tones/${kind}?page=${page}&page_size=${PAGE_SIZE}`);
    return { tones: res.data, page: res.page, totalPages: res.total_pages, total: res.total };
  }

  tone(id: number): Promise<T3kTone> {
    return this.json<T3kTone>(`/tones/${id}`);
  }

  /** All architectures: A1 and custom are the default; A2 needs architecture=2 (fetched separately). */
  async models(toneId: number): Promise<T3kModel[]> {
    const all = async (arch: string | null) => {
      const out: T3kModel[] = [];
      for (let page = 1; ; page++) {
        const res = await this.json<Paginated<T3kModel>>(`/models?tone_id=${toneId}&page=${page}&page_size=100${arch ? `&architecture=${arch}` : ""}`);
        out.push(...res.data);
        if (page >= res.total_pages || res.data.length === 0) return out;
      }
    };
    const [legacy, a2] = await Promise.all([all(null), all("2")]);
    const seen = new Set(legacy.map((m) => m.id));
    return [...legacy, ...a2.filter((m) => !seen.has(m.id))];
  }
}
