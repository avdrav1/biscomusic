// node --test tests/   (D1's free tier allows 5M row reads a day: the polled queries must read only what they need)
// Runs the real migrations and the stats queries against an in-memory SQLite, the engine under D1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { latestComments, latestFlames } from '../functions/_moments.js';

const dir = new URL('../migrations/', import.meta.url);
const JAMS = "instr(track, '/') = 0", SHOWS = "instr(track, '/') > 0";

function seeded() {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(dir).filter(f => f.endsWith('.sql')).sort())
    if (f !== '0009_fewer_reads.sql') db.exec(readFileSync(new URL(f, dir), 'utf8'));
  // Some history before the migration, as on the live database.
  let seed = 1;
  const rand = n => { seed = (seed * 16807) % 2147483647; return seed % n; };
  const tracks = [...Array(40)].map((_, k) => k % 3 ? `2026-05-${String(10 + k).padStart(2, '0')}-01` : `2001-01-01-x/${k}`);
  const react = db.prepare('INSERT OR IGNORE INTO reactions (track, bucket, ip_hash, created_at) VALUES (?, ?, ?, ?)');
  const say = db.prepare('INSERT INTO comments (track, pos, nickname, body, created_at, ip_hash, hidden) VALUES (?, ?, NULL, ?, ?, ?, ?)');
  const play = db.prepare("INSERT INTO plays (round, track, started_at, source) VALUES (?, ?, ?, 'rotation')");
  for (let k = 0; k < 3000; k++) react.run(tracks[rand(40)], rand(30), `ip${rand(50)}`, 1e12 + k * 1000);
  for (let k = 0; k < 400; k++) say.run(tracks[rand(40)], rand(600), 'hi', 1e12 + k * 7000 + 3, `ip${rand(50)}`, rand(10) ? 0 : 1);
  for (let k = 1; k <= 500; k++) play.run(k, tracks[rand(40)], 1e12 + k * 600_000);
  db.exec(readFileSync(new URL('0009_fewer_reads.sql', dir), 'utf8'));
  return db;
}

// The D1 statement our helpers build, run here: (sql, params) captured from env.DB.prepare(sql).bind(...params).
const run = (db, stmt) => { const s = stmt({ DB: { prepare: sql => ({ bind: (...p) => ({ sql, p }) }) } }); return db.prepare(s.sql).all(...s.p); };
const plan = (db, stmt) => { const s = stmt({ DB: { prepare: sql => ({ bind: (...p) => ({ sql, p }) }) } }); return db.prepare('EXPLAIN QUERY PLAN ' + s.sql).all(...s.p).map(r => r.detail).join('; '); };

test('last_played matches the history it replaces, and keeps up with new plays', () => {
  const db = seeded();
  const full = () => db.prepare('SELECT track, MAX(started_at) AS at FROM plays GROUP BY track ORDER BY track').all();
  const table = () => db.prepare('SELECT track, at FROM last_played ORDER BY track').all();
  assert.deepEqual(table(), full());
  db.prepare("INSERT INTO plays (round, track, started_at, source) VALUES (501, '2026-05-11-01', 2e12, 'vote'), (502, 'mix-new-01', 2e12 + 1, 'rotation')").run();
  db.prepare("INSERT OR IGNORE INTO plays (round, track, started_at, source) VALUES (501, '2026-05-11-01', 3e12, 'vote')").run();   // a replayed insert
  assert.deepEqual(table(), full());
});

test("Lately's newest comments and flames are the same as reading everything, through the time indexes", () => {
  const db = seeded();
  for (const [station, where] of [[JAMS, "instr(track, '/') = 0"], [SHOWS, "instr(track, '/') > 0"]]) {
    const oldComments = db.prepare(`SELECT id, track, pos, nickname, body, created_at AS at FROM comments WHERE hidden = 0 AND ${where} ORDER BY created_at DESC LIMIT 6`).all();
    assert.deepEqual(run(db, env => latestComments(env, station, 6)), oldComments);
    const oldFlames = db.prepare(`SELECT track, bucket, COUNT(*) AS n, MAX(created_at) AS at FROM reactions WHERE ${where} GROUP BY track, bucket ORDER BY at DESC LIMIT 6`).all();
    assert.deepEqual(run(db, env => latestFlames(env, station, 6)), oldFlames);
    assert.match(plan(db, env => latestComments(env, station, 6)), /comments_by_time/);
    assert.match(plan(db, env => latestFlames(env, station, 6)), /reactions_by_time/);
    assert.doesNotMatch(plan(db, env => latestComments(env, station, 6)), /TEMP B-TREE/);
  }
});
