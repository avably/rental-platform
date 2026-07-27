import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanupProductImageUploads } from "@/src/jobs/cleanup-product-image-uploads";

const NOW = new Date("2026-07-27T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCT_ID = "22222222-2222-4222-8222-222222222222";

type Status = "pending" | "processing" | "rejected" | "completed";

interface Intent {
  id: string;
  storage_path: string;
  status: Status;
  created_at: string;
  finished_at: string | null;
}

function path(id: string): string {
  return `${TENANT_ID}/${PRODUCT_ID}/${id}.png`;
}

function intent(
  id: string,
  status: Status,
  ageMs: number,
  finishedAgeMs: number | null = null,
): Intent {
  return {
    id,
    storage_path: path(id),
    status,
    created_at: new Date(NOW.getTime() - ageMs).toISOString(),
    finished_at:
      finishedAgeMs === null
        ? null
        : new Date(NOW.getTime() - finishedAgeMs).toISOString(),
  };
}

class FakeQuery {
  private operation: "select" | "delete" = "select";
  private paths: string[] = [];
  private ids: string[] = [];

  constructor(
    private readonly table: string,
    private readonly world: CleanupWorld,
  ) {}

  select(): this {
    this.operation = "select";
    return this;
  }

  delete(): this {
    this.operation = "delete";
    return this;
  }

  in(column: string, values: string[]): this {
    if (column === "storage_path") this.paths = values;
    if (column === "id") this.ids = values;
    return this;
  }

  or(): this {
    return this;
  }

  order(): this {
    return this;
  }

  limit(): this {
    return this;
  }

  then<T>(
    resolve: (value: {
      data: Record<string, unknown>[] | null;
      error: Error | null;
    }) => T,
  ) {
    if (this.operation === "delete") {
      this.world.intents = this.world.intents.filter((row) => !this.ids.includes(row.id));
      return Promise.resolve(resolve({ data: [], error: null }));
    }

    if (this.table === "product_image_uploads") {
      return Promise.resolve(
        resolve({
          data: this.world.intents.map((row) => ({ ...row })),
          error: null,
        }),
      );
    }

    if (this.table === "product_images") {
      return Promise.resolve(
        resolve({
          data: [...this.world.references]
            .filter((storagePath) => this.paths.includes(storagePath))
            .map((storagePath) => ({ storage_path: storagePath })),
          error: null,
        }),
      );
    }

    return Promise.resolve(resolve({ data: null, error: new Error("unknown table") }));
  }
}

class CleanupWorld {
  intents: Intent[];
  objects: Set<string>;
  references: Set<string>;
  removedBatches: string[][] = [];

  constructor(intents: Intent[], objects: string[], references: string[]) {
    this.intents = intents;
    this.objects = new Set(objects);
    this.references = new Set(references);
  }

  readonly db = {
    from: (table: string) => new FakeQuery(table, this),
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          this.removedBatches.push(paths);
          for (const storagePath of paths) this.objects.delete(storagePath);
          return { data: [], error: null };
        },
      }),
    },
  };
}

describe("cleanupProductImageUploads", () => {
  it("usuwa tylko stare sieroty, zachowuje referencje i świeże rekordy", async () => {
    const oldPending = intent("00000000-0000-4000-8000-000000000001", "pending", 2 * DAY);
    const oldProcessing = intent(
      "00000000-0000-4000-8000-000000000002",
      "processing",
      2 * DAY,
    );
    const oldRejected = intent(
      "00000000-0000-4000-8000-000000000003",
      "rejected",
      2 * DAY,
      2 * DAY,
    );
    const referencedProcessing = intent(
      "00000000-0000-4000-8000-000000000004",
      "processing",
      2 * DAY,
    );
    const freshPending = intent(
      "00000000-0000-4000-8000-000000000005",
      "pending",
      60 * 60 * 1000,
    );
    const recentCompleted = intent(
      "00000000-0000-4000-8000-000000000006",
      "completed",
      2 * DAY,
      2 * DAY,
    );
    const oldCompleted = intent(
      "00000000-0000-4000-8000-000000000007",
      "completed",
      9 * DAY,
      8 * DAY,
    );
    const all = [
      oldPending,
      oldProcessing,
      oldRejected,
      referencedProcessing,
      freshPending,
      recentCompleted,
      oldCompleted,
    ];
    const world = new CleanupWorld(
      all,
      all.map((row) => row.storage_path),
      [
        referencedProcessing.storage_path,
        recentCompleted.storage_path,
        oldCompleted.storage_path,
      ],
    );

    await expect(
      cleanupProductImageUploads({ now: NOW, db: world.db as never }),
    ).resolves.toEqual({
      scanned: 5,
      removedObjects: 3,
      removedIntents: 5,
    });

    expect(world.removedBatches).toEqual([
      [oldPending.storage_path, oldProcessing.storage_path, oldRejected.storage_path],
    ]);
    expect(world.objects.has(referencedProcessing.storage_path)).toBe(true);
    expect(world.objects.has(oldCompleted.storage_path)).toBe(true);
    expect(world.objects.has(freshPending.storage_path)).toBe(true);
    expect(world.intents.map((row) => row.id).sort()).toEqual(
      [freshPending.id, recentCompleted.id].sort(),
    );
  });
});

const cleanupRouteMock = vi.fn();
vi.doMock("@/src/jobs/cleanup-product-image-uploads", () => ({
  cleanupProductImageUploads: (...args: unknown[]) => cleanupRouteMock(...args),
}));

const originalCronSecret = process.env.CRON_SECRET;

async function routeRequest(authorization?: string) {
  const { GET } = await import("@/app/api/jobs/product-image-uploads/route");
  return GET(
    new Request("http://localhost/api/jobs/product-image-uploads", {
      headers: authorization ? { authorization } : undefined,
    }),
  );
}

describe("cron product-image-uploads", () => {
  beforeEach(() => {
    cleanupRouteMock.mockReset();
    cleanupRouteMock.mockResolvedValue({
      scanned: 2,
      removedObjects: 1,
      removedIntents: 2,
    });
    delete process.env.CRON_SECRET;
  });

  afterAll(() => {
    if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalCronSecret;
  });

  it("bez skonfigurowanego sekretu zwraca 503", async () => {
    const response = await routeRequest();
    expect(response.status).toBe(503);
    expect(cleanupRouteMock).not.toHaveBeenCalled();
  });

  it("brak albo zły Bearer zwraca 401", async () => {
    process.env.CRON_SECRET = "sekret-testowy";
    expect((await routeRequest()).status).toBe(401);
    expect((await routeRequest("Bearer wrong")).status).toBe(401);
    expect(cleanupRouteMock).not.toHaveBeenCalled();
  });

  it("poprawny sekret uruchamia job i zwraca wynik", async () => {
    process.env.CRON_SECRET = "sekret-testowy";
    const response = await routeRequest("Bearer sekret-testowy");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      scanned: 2,
      removedObjects: 1,
      removedIntents: 2,
    });
  });

  it("awaria joba zwraca 500", async () => {
    process.env.CRON_SECRET = "sekret-testowy";
    cleanupRouteMock.mockRejectedValueOnce(new Error("job failed"));
    const response = await routeRequest("Bearer sekret-testowy");
    expect(response.status).toBe(500);
  });
});
