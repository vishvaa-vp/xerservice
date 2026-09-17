import { NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    const headers = {
        "Cache-Control": "no-store, max-age=0",
        "Content-Type": "application/json",
    };

    try {
        const client = getServiceRoleClient();
        const { error } = await client.from("shops").select("id").limit(1);

        if (error) {
            console.error("[Health] Database connectivity check error:", error.message);
            return NextResponse.json(
                {
                    status: "degraded",
                    error: "Database connectivity failure",
                },
                { status: 503, headers }
            );
        }

        return NextResponse.json(
            {
                status: "ok",
                timestamp: new Date().toISOString(),
            },
            { status: 200, headers }
        );
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[Health] Service health check error:", msg);
        return NextResponse.json(
            {
                status: "degraded",
                error: "Service health check failure",
            },
            { status: 503, headers }
        );
    }
}
