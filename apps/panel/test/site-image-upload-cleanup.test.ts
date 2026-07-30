/**
 * Cron sierot zdjęć SEKCJI (0043) — LUSTRO cleanup-product-image-uploads.test.ts.
 * Różnica: referencje sprawdza app.site_image_paths_in_use (content jsonb sekcji),
 * nie tabela-katalog. Testy pilnują, że kasujemy TYLKO stare sieroty
 * (nie-completed, nieużywane), a referencje i świeże rekordy zostają.
 */
import { readFileSync } from "node:fs";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanupSiteImageUploads } from "@/src/jobs/cleanup-site-image-uploads";

const NOW = new Date("2026-07-27T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const SITE_ID = "22222222-2222-4222-8222-222222222222";

type Status = "pending" | "processing" | "rejected" | "completed";

interface Intent {
  id: string;
  storage_path: string;
  status: Status;
  created_at: string;
  finished_at: string | null;
}

function path(id: string): string {
  return `${TENANT_ID}/${SITE_ID}/${id}.png`;
}

function intent(id: string, status: Status, ageMs: number, finishedAgeMs: number | null = null): Intent {
  return {
    id,
    storage_path: path(id),
    status,
    created_at: new Date(NOW.getTime() - ageMs).toISOString(),
    finished_at: finishedAgeMs === null ? null : new Date(NOW.getTime() - finishedAgeMs).toISOString(),
  };
}

class FakeQuery {
  private operation: "select" | "delete" = "select";
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

  then<T>(resolve: (value: { data: Record<string, unknown>[] | null; error: Error | null }) => T) {
    if (this.operation === "delete") {
      this.world.intents = this.world.intents.filter((row) => !this.ids.includes(row.id));
      return Promise.resolve(resolve({ data: [], error: null }));
    }
    if (this.table === "site_image_uploads") {
      return Promise.resolve(resolve({ data: this.world.intents.map((row) => ({ ...row })), error: null }));
    }
    return Promise.resolve(resolve({ data: null, error: new Error("unknown table") }));
  }
}

class CleanupWorld {
  intents: Intent[];
  objects: Set<string>;
  references: Set<string>;
  removedBatches: string[][] = [];
  /** Rejestr wywołań RPC — pin okablowania cron↔RPC (nazwa + przekazane ścieżki). */
  rpcCalls: { name: string; paths: string[] }[] = [];

  constructor(intents: Intent[], objects: string[], references: string[]) {
    this.intents = intents;
    this.objects = new Set(objects);
    this.references = new Set(references);
  }

  readonly db = {
    from: (table: string) => new FakeQuery(table, this),
    schema: (schema: string) => {
      if (schema !== "app") throw new Error(`nieoczekiwany schemat: ${schema}`);
      return {
        rpc: async (name: string, args: { p_paths: string[] }) => {
          // Rejestrujemy KAŻDE wywołanie (także ze złą nazwą) — dzięki temu test
          // asertuje, że cron woła DOKŁADNIE site_image_paths_in_use.
          this.rpcCalls.push({ name, paths: [...(args?.p_paths ?? [])] });
          // Zbiór chroniony liczy WYŁĄCZNIE właściwa nazwa; zła nazwa → pusto
          // (jak zerwane okablowanie: chroniona ścieżka zostałaby skasowana).
          // Kształt setof text jak PostgREST (tablica skalarów).
          const data =
            name === "site_image_paths_in_use"
              ? args.p_paths.filter((p) => this.references.has(p))
              : [];
          return { data, error: null };
        },
      };
    },
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

describe("cleanupSiteImageUploads", () => {
  it("usuwa tylko stare sieroty, zachowuje referencje i świeże rekordy", async () => {
    const oldPending = intent("00000000-0000-4000-8000-000000000001", "pending", 2 * DAY);
    const oldProcessing = intent("00000000-0000-4000-8000-000000000002", "processing", 2 * DAY);
    const oldRejected = intent("00000000-0000-4000-8000-000000000003", "rejected", 2 * DAY, 2 * DAY);
    const referencedProcessing = intent("00000000-0000-4000-8000-000000000004", "processing", 2 * DAY);
    const freshPending = intent("00000000-0000-4000-8000-000000000005", "pending", 60 * 60 * 1000);
    const recentCompleted = intent("00000000-0000-4000-8000-000000000006", "completed", 2 * DAY, 2 * DAY);
    const oldCompleted = intent("00000000-0000-4000-8000-000000000007", "completed", 9 * DAY, 8 * DAY);

    const all = [oldPending, oldProcessing, oldRejected, referencedProcessing, freshPending, recentCompleted, oldCompleted];
    const world = new CleanupWorld(
      all,
      all.map((row) => row.storage_path),
      [referencedProcessing.storage_path, recentCompleted.storage_path, oldCompleted.storage_path],
    );

    await expect(cleanupSiteImageUploads({ now: NOW, db: world.db as never })).resolves.toEqual({
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
    expect(world.intents.map((row) => row.id).sort()).toEqual([freshPending.id, recentCompleted.id].sort());
  });

  it("PIN okablowania: cron woła site_image_paths_in_use i CHRONI jego wynik", async () => {
    // X (referencjonowany) i Y (sierota) — oba stare, nie-completed. RPC zwraca
    // WYŁĄCZNIE X; cron musi go zachować, a Y skasować. Zła nazwa RPC / brak
    // wywołania / zignorowanie wyniku → ta asercja pada.
    const referenced = intent("00000000-0000-4000-8000-0000000000a1", "processing", 2 * DAY);
    const orphan = intent("00000000-0000-4000-8000-0000000000a2", "processing", 2 * DAY);
    const world = new CleanupWorld(
      [referenced, orphan],
      [referenced.storage_path, orphan.storage_path],
      [referenced.storage_path], // tylko X jest w użyciu
    );

    await cleanupSiteImageUploads({ now: NOW, db: world.db as never });

    // (a) cron ZAWOŁAŁ dokładnie site_image_paths_in_use z kandydatami.
    expect(world.rpcCalls).toHaveLength(1);
    expect(world.rpcCalls[0]?.name).toBe("site_image_paths_in_use");
    expect(world.rpcCalls[0]?.paths).toEqual(
      expect.arrayContaining([referenced.storage_path, orphan.storage_path]),
    );
    // (b) WYNIK RPC jest zbiorem chronionym: X (zwrócony) zostaje, Y znika.
    expect(world.objects.has(referenced.storage_path), "referencja skasowana — wynik RPC zignorowany").toBe(true);
    expect(world.objects.has(orphan.storage_path), "sierota nie skasowana").toBe(false);
    expect(world.removedBatches).toEqual([[orphan.storage_path]]);
  });
});

const cleanupRouteMock = vi.fn();
vi.doMock("@/src/jobs/cleanup-site-image-uploads", () => ({
  cleanupSiteImageUploads: (...args: unknown[]) => cleanupRouteMock(...args),
}));

const originalCronSecret = process.env.CRON_SECRET;

async function routeRequest(authorization?: string) {
  const { GET } = await import("@/app/api/jobs/site-image-uploads/route");
  return GET(
    new Request("http://localhost/api/jobs/site-image-uploads", {
      headers: authorization ? { authorization } : undefined,
    }),
  );
}

describe("cron site-image-uploads", () => {
  it("ma dzienny harmonogram (Vercel Hobby) obok crona zdjęć produktów", () => {
    const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as {
      crons: Array<{ path: string; schedule: string }>;
    };
    expect(config.crons).toContainEqual({ path: "/api/jobs/site-image-uploads", schedule: "37 3 * * *" });
    // Dzienny (raz na dobę) — zgodnie z ograniczeniem Hobby.
    const site = config.crons.find((c) => c.path === "/api/jobs/site-image-uploads");
    expect(site?.schedule).toMatch(/^\d+ \d+ \* \* \*$/);
  });

  beforeEach(() => {
    cleanupRouteMock.mockReset();
    cleanupRouteMock.mockResolvedValue({ scanned: 2, removedObjects: 1, removedIntents: 2 });
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
    await expect(response.json()).resolves.toEqual({ scanned: 2, removedObjects: 1, removedIntents: 2 });
  });

  it("awaria joba zwraca 500", async () => {
    process.env.CRON_SECRET = "sekret-testowy";
    cleanupRouteMock.mockRejectedValueOnce(new Error("job failed"));
    const response = await routeRequest("Bearer sekret-testowy");
    expect(response.status).toBe(500);
  });
});
