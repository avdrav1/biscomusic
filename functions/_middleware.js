// Host routing for the three sites in this deploy (see _hosts.js). Shared files skip this (site/_routes.json).
import { route } from './_hosts.js';

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  const to = route(url);
  if (!to) return next();
  // 302, not 301: browsers would keep a permanent redirect even if the sites are rearranged later.
  if (to.redirect) return Response.redirect(to.redirect, 302);
  return env.ASSETS.fetch(new Request(new URL(to.asset, url), request));
}
