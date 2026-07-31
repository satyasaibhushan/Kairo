import { NextResponse } from "next/server";
import { authenticateOwner, createOwnerSession } from "../../../auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { password?: unknown };
    if (typeof body.password !== "string") {
      return NextResponse.json({ error: "Password is required" }, { status: 400 });
    }
    if (!(await authenticateOwner(body.password))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await createOwnerSession();
    return NextResponse.json({ authenticated: true });
  } catch {
    return NextResponse.json({ error: "Login is not configured" }, { status: 503 });
  }
}
