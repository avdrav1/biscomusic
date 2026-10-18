// Tells the player that comments are available (server.py has no /api, so it gets a 404).
export function onRequestGet({ env }) {
  return new Response(JSON.stringify({ comments: true, turnstileSiteKey: env.TURNSTILE_SITEKEY }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
