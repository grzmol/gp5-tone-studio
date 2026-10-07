import type { HostApi } from "../shared/host";

declare global {
  interface Window {
    gp5host?: HostApi;
  }
}
export {};
