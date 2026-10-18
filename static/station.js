// Shared by index.html and best.html: talking to the voting station (functions/api/station.js, vote.js).
window.Station = {
  // The current station view, or null when there's no API (local server.py).
  async get() {
    try { const r = await fetch('/api/station'); return r.ok ? await r.json() : null; } catch (e) { return null; }
  },

  // Vote for the track after the current one. Resolves to { view } or { error }.
  async vote(round, track) {
    try {
      const r = await fetch('/api/vote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ round, track }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return { error: data.error || 'Couldn’t vote. Try again.', stale: r.status === 409 };
      try { localStorage.setItem('vote:' + round, track); } catch (e) {}
      return { view: data };
    } catch (e) { return { error: 'Couldn’t vote. Check your connection.' }; }
  },

  myVote(round) { try { return localStorage.getItem('vote:' + round); } catch (e) { return null; } },

  // Why a track can't be voted for right now, or '' if it can.
  blocked(view, track) {
    if (track === view.track) return 'On air';
    if (view.next && track === view.next.track) return 'Up next';
    if (!view.voting_open || Date.now() >= view.lock_at) return 'Voting closed';
    if (view.recent.includes(track)) return 'Played recently';
    return '';
  },
};
