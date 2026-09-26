// _shared/cors.ts — helper CORS generik dipakai semua Edge Function.
// ALLOWED_ORIGIN dibaca dari env var (fallback "*" kalau belum diset) sejak
// awal development, bukan ditambal belakangan (ARCHITECTURE.md §5.12).

export function corsHeaders(): Record<string, string> {
  const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}
