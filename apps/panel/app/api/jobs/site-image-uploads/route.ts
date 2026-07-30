import { timingSafeEqual } from "node:crypto";

import { cleanupSiteImageUploads } from "@/src/jobs/cleanup-site-image-uploads";

export const runtime = "nodejs";

function authorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ error: "Job nie jest skonfigurowany." }, { status: 503 });
  }
  if (!authorized(request.headers.get("authorization"), secret)) {
    return Response.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  try {
    return Response.json(await cleanupSiteImageUploads());
  } catch (error) {
    console.error("Cleanup uploadów zdjęć sekcji nie powiódł się.", error);
    return Response.json({ error: "Cleanup nie powiódł się." }, { status: 500 });
  }
}
