import { describe, expect, it } from "vitest";
import { clusterAreaRequests } from "../admin-area-request-queries";

describe("clusterAreaRequests", () => {
  it("groups nearby requests and ranks by distinct customers", () => {
    const rows = [
      { user_id: "a", lat: 29.9602, lng: 31.2569, created_at: "2026-11-09T10:00:00Z" },
      { user_id: "a", lat: 29.9611, lng: 31.2571, created_at: "2026-11-09T11:00:00Z" },
      { user_id: "b", lat: 29.9605, lng: 31.2566, created_at: "2026-11-09T09:00:00Z" },
      { user_id: "c", lat: 30.1, lng: 31.4, created_at: "2026-11-08T09:00:00Z" },
    ];
    const clusters = clusterAreaRequests(rows);
    expect(clusters).toHaveLength(2);
    expect(clusters[0]).toMatchObject({
      requests: 3,
      customers: 2,
      latestAt: "2026-11-09T11:00:00Z",
    });
    expect(clusters[1]).toMatchObject({ requests: 1, customers: 1 });
  });
});
