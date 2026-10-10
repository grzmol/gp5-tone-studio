import { describe, expect, it } from "vitest";
import { isNewer, latestReleaseVersion } from "./update";

describe("isNewer", () => {
  it("compares numerically, not as text", () => {
    expect(isNewer("0.10.0", "0.9.9")).toBe(true);
    expect(isNewer("0.9.9", "0.10.0")).toBe(false);
    expect(isNewer("v1.0.0", "0.99.99")).toBe(true);
  });
  it("never offers the same or an older version", () => {
    expect(isNewer("0.3.0", "0.3.0")).toBe(false);
    expect(isNewer("0.2.9", "0.3.0")).toBe(false);
  });
  it("never offers pre-releases or malformed versions", () => {
    expect(isNewer("0.4.0-beta.1", "0.3.0")).toBe(false);
    expect(isNewer("0.4", "0.3.0")).toBe(false);
    expect(isNewer("latest", "0.3.0")).toBe(false);
  });
});

describe("latestReleaseVersion", () => {
  const release = { tag_name: "v0.4.0", draft: false, prerelease: false };
  it("reads the version of a published release", () => {
    expect(latestReleaseVersion(release)).toBe("0.4.0");
  });
  it("ignores drafts, pre-releases and tags that aren't versions", () => {
    expect(latestReleaseVersion({ ...release, draft: true })).toBeNull();
    expect(latestReleaseVersion({ ...release, prerelease: true })).toBeNull();
    expect(latestReleaseVersion({ ...release, tag_name: "v0.4.0/../../evil" })).toBeNull();
    expect(latestReleaseVersion({ tag_name: "v0.4.0" })).toBeNull();
    expect(latestReleaseVersion(null)).toBeNull();
  });
});
