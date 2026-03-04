import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import express from 'express';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.resolve(process.cwd(), 'config', 'leagues.json');
const CACHE_DIR = path.resolve(process.cwd(), 'storage', 'cache', 'tsdb');
const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Ensure cache directory exists
try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch (e) {}

function logError(ctx) {
  // keep minimal to avoid leaking keys
  console.error('[FootballService]', ctx);
}

async function readConfig() {
  const raw = await fs.promises.readFile(CONFIG_PATH, 'utf8');
  return JSON.parse(raw);
}

async function writeConfig(cfg) {
  await fs.promises.writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

function cacheKey(prefix, params) {
  const key = prefix + ':' + JSON.stringify(params || {});
  // sanitize for filenames (avoid characters invalid on Windows like ':')
  return key.replace(/[^a-z0-9._-]/gi, '_');
}

async function readCache(key) {
  const file = path.join(CACHE_DIR, key + '.json');
  try {
    const raw = await fs.promises.readFile(file, 'utf8');
    const obj = JSON.parse(raw);
    return obj;
  } catch (e) {
    return null;
  }
}

async function writeCache(key, data) {
  const file = path.join(CACHE_DIR, key + '.json');
  const obj = { ts: Date.now(), data };
  await fs.promises.writeFile(file, JSON.stringify(obj), 'utf8');
}

async function fetchWithTimeout(url, opts = {}, timeout = 17000, retryOnce = true) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal, ...opts });
    clearTimeout(id);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      err.body = text;
      throw err;
    }
    return await res.json();
  } catch (err) {
    if (retryOnce && (err.type === 'aborted' || (err.status && err.status >= 500))) {
      // simple 1x retry
      return fetchWithTimeout(url, opts, timeout, false);
    }
    throw err;
  }
}

class FootballDataService {
  constructor() {
    this.v2Key = process.env.THE_SPORTSDB_V2_KEY || null;
    this.v1Key = process.env.THE_SPORTSDB_V1_KEY || '123';
  }

  async getBaseUrls() {
    return {
      v1: 'https://www.thesportsdb.com/api/v1/json/' + this.v1Key,
      v2: 'https://www.thesportsdb.com/api/v2/json'
    };
  }

  async resolveLeagueIdIfMissing(slug) {
    const cfg = await readConfig();
    if (cfg[slug] && cfg[slug] !== null) return cfg[slug];

    // Try to find by searching leagues (v2 preferred)
    const namesToMatch = {
      campeonato_carioca: ['Carioca', 'Campeonato Carioca'],
      campeonato_gaucho: ['Gaúcho', 'Gaucho', 'Campeonato Gaúcho']
    };

    const keys = namesToMatch[slug] || [slug.replace(/_/g, ' ')];

    // Try v2 search if key present
    const sV2 = this.v2Key ? await this._searchV2LeagueCandidates(keys).catch(e => { logError({ msg: 'v2 search failed', league: slug, err: e.message }); return null; }) : null;
    if (sV2 && sV2.id) {
      cfg[slug] = parseInt(sV2.id, 10);
      await writeConfig(cfg);
      return cfg[slug];
    }

    // Fall back to v1 search (search_all_leagues.php?s=Soccer)
    const base = (await this.getBaseUrls()).v1;
    const url = `${base}/search_all_leagues.php?s=Soccer`;
    try {
      const json = await fetchWithTimeout(url, {}, 20000);
      const leagues = json.countrys || json.leagues || json.countries || [];
      const found = leagues.find(l => {
        const name = (l.strLeague || l.league || '').toLowerCase();
        return keys.some(k => name.includes(k.toLowerCase()));
      });
      if (found && found.idLeague) {
        cfg[slug] = parseInt(found.idLeague, 10);
        await writeConfig(cfg);
        return cfg[slug];
      }
    } catch (e) {
      logError({ msg: 'v1 search failed', league: slug, err: e.message });
      throw e;
    }

    throw new Error('League id not found for slug: ' + slug);
  }

  async _searchV2LeagueCandidates(keys) {
    // v2 search per slug isn't well documented; try search endpoint per key
    const base = (await this.getBaseUrls()).v2;
    for (const k of keys) {
      const url = `${base}/search/league/${encodeURIComponent(k)}`;
      try {
        const json = await fetchWithTimeout(url, { headers: { 'X-API-KEY': this.v2Key } }, 20000);
        if (json && json.leagues && json.leagues.length) {
          const first = json.leagues[0];
          if (first.id) return { id: first.id };
        }
      } catch (e) {
        // continue
      }
    }
    return null;
  }

  async getNextEventsByLeagueId(idLeague, options = {}) {
    const ttl = (options.ttlMs) || DEFAULT_TTL_MS;
    const cacheK = cacheKey('next:id', { idLeague });
    const cached = await readCache(cacheK);
    if (cached && (Date.now() - cached.ts) < ttl) return cached.data;

    // Try v2 first if key exists
    const baseUrls = await this.getBaseUrls();
    let json = null;
    if (this.v2Key) {
      const url = `${baseUrls.v2}/schedule/next/league/${idLeague}`;
      try {
        json = await fetchWithTimeout(url, { headers: { 'X-API-KEY': this.v2Key } }, 20000);
      } catch (e) {
        if (e.status === 401 || e.status === 403) {
          logError({ msg: 'v2 unauthorized, fallback to v1', leagueId: idLeague });
          json = null; // fallback
        } else {
          logError({ msg: 'v2 fetch error', leagueId: idLeague, err: e.message });
        }
      }
    }

    if (!json) {
      const url = `${baseUrls.v1}/eventsnextleague.php?id=${idLeague}`;
      try {
        json = await fetchWithTimeout(url, {}, 20000);
      } catch (e) {
        logError({ msg: 'v1 fetch error', leagueId: idLeague, err: e.message });
        throw e;
      }
    }

    const events = (json.events || json.event || json.matchs || json.matches || []);
    const normalized = (events || []).map(ev => this._normalizeEvent(ev, idLeague));
    await writeCache(cacheK, normalized);
    // Enrich with badges/players/canal if requested
    if (options.enrich) {
      return await this.enrichEvents(normalized, options);
    }
    return normalized;
  }

  async getNextEventsBySlug(slug, options = {}) {
    const cfg = await readConfig();
    let id = cfg[slug];
    if (!id) {
      id = await this.resolveLeagueIdIfMissing(slug);
    }
    return this.getNextEventsByLeagueId(id, options);
  }

  _normalizeEvent(ev, idLeagueFallback) {
    // Standardize common fields
    return {
      idEvent: ev.idEvent || ev.id || ev.event_id || null,
      dateEvent: ev.dateEvent || ev.date || ev.strTimestamp?.split('T')?.[0] || ev.match_date || null,
      strTime: ev.strTime || ev.time || ev.strTimestamp?.split('T')?.[1] || null,
      idHomeTeam: ev.idHomeTeam || ev.homeTeamId || ev.home_id || ev.strHomeTeamId || null,
      idAwayTeam: ev.idAwayTeam || ev.awayTeamId || ev.away_id || ev.strAwayTeamId || null,
      strHomeTeam: ev.strHomeTeam || ev.homeTeam || ev.home_name || ev.homeTeamName || null,
      strAwayTeam: ev.strAwayTeam || ev.awayTeam || ev.away_name || ev.awayTeamName || null,
      intHomeScore: ev.intHomeScore != null ? Number(ev.intHomeScore) : (ev.homeScore != null ? Number(ev.homeScore) : null),
      intAwayScore: ev.intAwayScore != null ? Number(ev.intAwayScore) : (ev.awayScore != null ? Number(ev.awayScore) : null),
      strVenue: ev.strVenue || ev.venue || ev.stadium || null,
      strLeague: ev.strLeague || ev.league || null,
      idLeague: ev.idLeague || ev.league_id || idLeagueFallback || null,
      strSeason: ev.strSeason || ev.season || null,
      raw: ev
    };
  }

  // --- Enrichment helpers ---
  async getTeamBadgeUrl(teamId) {
    if (!teamId) return null;
    const key = cacheKey('team:badge', { teamId });
    const cached = await readCache(key);
    const TTL = 24 * 60 * 60 * 1000; // 24h
    if (cached && (Date.now() - cached.ts) < TTL) return cached.data;
    const base = (await this.getBaseUrls()).v1;
    const url = `${base}/lookupteam.php?id=${teamId}`;
    try {
      const json = await fetchWithTimeout(url, {}, 15000);
      const team = (json.teams && json.teams[0]) || null;
      const badge = team ? (team.strTeamBadge || team.strBadge || null) : null;
      await writeCache(key, badge);
      return badge;
    } catch (e) {
      logError({ msg: 'team badge fetch failed', teamId, err: e.message });
      return null;
    }
  }

  async getTeamPlayersList(teamId) {
    if (!teamId) return [];
    const key = cacheKey('team:players', { teamId });
    const cached = await readCache(key);
    const TTL = 24 * 60 * 60 * 1000; // 24h
    if (cached && (Date.now() - cached.ts) < TTL) return cached.data;
    const base = (await this.getBaseUrls()).v1;
    const url = `${base}/lookup_all_players.php?id=${teamId}`;
    try {
      const json = await fetchWithTimeout(url, {}, 15000);
      const players = json.player || json.players || [];
      await writeCache(key, players);
      return players;
    } catch (e) {
      logError({ msg: 'team players fetch failed', teamId, err: e.message });
      return [];
    }
  }

  _pickPlayersFromList(players, count = 1, overrides = []) {
    if (!players || !players.length) return [];
    // Normalize names for matching
    const byName = new Map();
    for (const p of players) {
      const name = (p.strPlayer || p.player || '').trim();
      if (name) byName.set(name.toLowerCase(), p);
    }
    const selected = [];
    // First try overrides
    for (const name of overrides) {
      const p = byName.get(name.toLowerCase());
      if (p && (p.strCutout || p.strThumb || p.strRender || p.strThumbCutout)) {
        selected.push(p);
        if (selected.length >= count) return selected;
      }
    }

    // Preferred positions
    const prefs = ['ST','CF','LW','RW','AM','CAM','CM','FW','MF','DF','GK'];
    // Try by position + cutout/thumb
    for (const pos of prefs) {
      for (const p of players) {
        if (selected.length >= count) break;
        const position = (p.strPosition || p.position || '').toUpperCase();
        const hasImg = p.strCutout || p.strThumb || p.strRender || p.strThumbCutout;
        if (position.includes(pos) && hasImg && !selected.includes(p)) selected.push(p);
      }
      if (selected.length >= count) break;
    }

    // Fill with any players with images
    if (selected.length < count) {
      for (const p of players) {
        if (selected.length >= count) break;
        const hasImg = p.strCutout || p.strThumb || p.strRender || p.strThumbCutout;
        if (hasImg && !selected.includes(p)) selected.push(p);
      }
    }

    return selected.slice(0, count);
  }

  async getPlayersForTeam(teamId, teamSide, count = 1) {
    if (!teamId) return [];
    // load overrides
    const overridesPath = path.resolve(process.cwd(), 'config', 'player_overrides.json');
    let overrides = {};
    try {
      if (fs.existsSync(overridesPath)) overrides = JSON.parse(await fs.promises.readFile(overridesPath, 'utf8'));
    } catch (e) { /* ignore */ }
    const overrideNames = (overrides[teamId] || []);

    const players = await this.getTeamPlayersList(teamId);
    const picked = this._pickPlayersFromList(players, count, overrideNames);
    return picked.map(p => ({ teamSide, playerName: p.strPlayer || p.player || null, imageUrl: p.strCutout || p.strThumb || p.strRender || null }));
  }

  async findCanalOficialForEvent(ev) {
    // Try v2 TV guide if available
    if (this.v2Key) {
      const base = (await this.getBaseUrls()).v2;
      const cacheK = cacheKey('tv:match', { league: ev.idLeague, date: ev.dateEvent });
      const cached = await readCache(cacheK);
      const TTL = 60 * 60 * 1000; // 60 min
      if (cached && (Date.now() - cached.ts) < TTL) return cached.data;
      try {
        // Attempt to query a likely endpoint - best-effort
        const url = `${base}/filter/tv/sport/soccer`;
        const json = await fetchWithTimeout(url, { headers: { 'X-API-KEY': this.v2Key } }, 20000);
        const items = json.items || json.tv || json.channels || [];
        // Try to find by team names and date
        const nameA = (ev.strHomeTeam || '').toLowerCase();
        const nameB = (ev.strAwayTeam || '').toLowerCase();
        for (const it of items) {
          const text = JSON.stringify(it).toLowerCase();
          if (text.includes(nameA) && text.includes(nameB) && text.includes((ev.dateEvent||'').toLowerCase())) {
            const chan = it.channel || it.network || it.name || null;
            await writeCache(cacheK, chan);
            return chan;
          }
        }
      } catch (e) {
        logError({ msg: 'tv guide v2 failed', err: e.message });
      }
    }
    // Fallback to broadcasters.json mapping
    try {
      const bpath = path.resolve(process.cwd(), 'config', 'broadcasters.json');
      if (fs.existsSync(bpath)) {
        const map = JSON.parse(await fs.promises.readFile(bpath, 'utf8'));
        const cfg = await readConfig();
        // try by league slug
        const slug = Object.keys(cfg).find(k => String(cfg[k]) === String(ev.idLeague));
        if (slug && map[slug]) return map[slug];
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  async enrichEvents(events, options = {}) {
    const out = [];
    const playersCount = options.playersCount != null ? Number(options.playersCount) : 1;
    for (const ev of events) {
      // Sempre priorizar badge do evento, depois buscar do SportsDB pelo ID
      const PLACEHOLDER = 'uyhbfe1612467038.png';
      let homeBadgeEv = ev.raw?.strHomeTeamBadge || null;
      let awayBadgeEv = ev.raw?.strAwayTeamBadge || null;
      const homeId = ev.idHomeTeam || null;
      const awayId = ev.idAwayTeam || null;
      let homeBadgeLookup = null;
      let awayBadgeLookup = null;
      if (homeId) homeBadgeLookup = await this.getTeamBadgeUrl(homeId);
      if (awayId) awayBadgeLookup = await this.getTeamBadgeUrl(awayId);
      // Função para decidir qual badge usar
      function escolherBadge(evBadge, lookupBadge) {
        if (evBadge && !evBadge.endsWith(PLACEHOLDER)) return evBadge;
        if (lookupBadge && !lookupBadge.endsWith(PLACEHOLDER)) return lookupBadge;
        return evBadge || lookupBadge || null;
      }
      let homeBadge = escolherBadge(homeBadgeEv, homeBadgeLookup);
      let awayBadge = escolherBadge(awayBadgeEv, awayBadgeLookup);
      let players = [];
      if (playersCount > 0) {
        const homePlayers = await this.getPlayersForTeam(homeId, 'home', Math.ceil(playersCount/2));
        const awayPlayers = await this.getPlayersForTeam(awayId, 'away', Math.floor(playersCount/2));
        players = [...homePlayers, ...awayPlayers].slice(0, playersCount);
      }
      const canal = await this.findCanalOficialForEvent(ev).catch(() => null);
      out.push({ ...ev, homeBadgeUrl: homeBadge, awayBadgeUrl: awayBadge, players, canal_oficial: canal || null });
    }
    return out;
  }
}

// Express router exposing endpoints
const router = express.Router();
const svc = new FootballDataService();

router.get('/leagues', async (req, res) => {
  try {
    const cfg = await readConfig();
    const out = Object.keys(cfg).map(k => ({ slug: k, id: cfg[k], name: k.replace(/_/g, ' ') }));
    res.json({ success: true, leagues: out });
  } catch (e) {
    logError({ msg: 'leagues list failed', err: e.message });
    res.status(500).json({ success: false, error: 'failed to read leagues' });
  }
});

router.get('/next', async (req, res) => {
  const slug = req.query.league;
  if (!slug) return res.status(400).json({ success: false, error: 'missing league param' });
  try {
    const playersCount = req.query.playersCount ? Number(req.query.playersCount) : 1;
    const events = await svc.getNextEventsBySlug(slug, { enrich: true, playersCount });
    res.json({ success: true, league: slug, events });
  } catch (e) {
    logError({ msg: 'next failed', league: slug, err: e.message });
    res.status(500).json({ success: false, error: 'failed to fetch next events' });
  }
});

router.get('/next-multi', async (req, res) => {
  const list = (req.query.leagues || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!list.length) return res.status(400).json({ success: false, error: 'missing leagues param' });
  try {
    const all = [];
    for (const slug of list) {
      try {
        const events = await svc.getNextEventsBySlug(slug, { enrich: true, playersCount: 1 });
        events.forEach(e => e._league_slug = slug);
        all.push(...events);
      } catch (e) {
        logError({ msg: 'partial fetch failed', league: slug, err: e.message });
      }
    }
    // sort by dateEvent + strTime
    all.sort((a, b) => {
      const da = (a.dateEvent || '') + ' ' + (a.strTime || '');
      const db = (b.dateEvent || '') + ' ' + (b.strTime || '');
      return da.localeCompare(db);
    });
    res.json({ success: true, events: all });
  } catch (e) {
    logError({ msg: 'next-multi failed', err: e.message });
    res.status(500).json({ success: false, error: 'failed to fetch multi' });
  }
});

// NOVO: Endpoint para buscar TODOS os jogos do dia de TODAS as ligas
router.get('/jogos-hoje', async (req, res) => {
  try {
    const cfg = await readConfig();
    const allLeagues = Object.keys(cfg);
    const hoje = new Date().toISOString().slice(0, 10);
    
    console.log(`📅 Buscando jogos de hoje (${hoje}) em ${allLeagues.length} ligas...`);
    
    // Buscar jogos de todas as ligas em paralelo
    const promises = allLeagues.map(async slug => {
      try {
        const events = await svc.getNextEventsBySlug(slug, { enrich: true, playersCount: 2 });
        return { slug, events };
      } catch (err) {
        console.error(`❌ Erro ao buscar ${slug}:`, err.message);
        return { slug, events: [] };
      }
    });
    
    const results = await Promise.all(promises);
    
    // Filtrar apenas jogos de hoje e flatten
    let jogosHoje = [];
    results.forEach(({ slug, events }) => {
      const filtrados = events.filter(ev => ev.dateEvent === hoje);
      filtrados.forEach(ev => {
        jogosHoje.push({
          ...ev,
          slug_liga: slug
        });
      });
    });
    
    // Ordenar por horário
    jogosHoje.sort((a, b) => {
      if (a.strTime && b.strTime) {
        return a.strTime.localeCompare(b.strTime);
      }
      return 0;
    });
    
    console.log(`✅ Total de jogos hoje: ${jogosHoje.length}`);
    
    res.json({ 
      success: true, 
      date: hoje,
      total: jogosHoje.length,
      events: jogosHoje.map(ev => ({
        idEvent: ev.idEvent,
        dateEvent: ev.dateEvent,
        strTime: ev.strTime,
        strHomeTeam: ev.strHomeTeam,
        strAwayTeam: ev.strAwayTeam,
        idHomeTeam: ev.idHomeTeam,
        idAwayTeam: ev.idAwayTeam,
        homeBadgeUrl: ev.homeBadgeUrl || null,
        awayBadgeUrl: ev.awayBadgeUrl || null,
        strLeague: ev.strLeague,
        slug_liga: ev.slug_liga,
        canal_oficial: ev.canal_oficial || null,
        players: ev.players || []
      }))
    });
  } catch (e) {
    logError({ msg: 'jogos-hoje failed', err: e.message });
    res.status(500).json({ success: false, error: 'Falha ao buscar jogos de hoje' });
  }
});

router.get('/banner', async (req, res) => {
  const slug = req.query.league;
  const mode = req.query.mode || 'teams';
  const playersCount = req.query.playersCount ? Number(req.query.playersCount) : 1;
  if (!slug) return res.status(400).json({ success: false, error: 'missing league param' });
  if (!['teams','players'].includes(mode)) return res.status(400).json({ success: false, error: 'invalid mode' });
  try {
    const events = await svc.getNextEventsBySlug(slug, { enrich: true, playersCount });
    // For banner, return top N events (limit 10)
    const sliced = events.slice(0, 10).map(ev => {
      if (mode === 'teams') {
        return {
          idEvent: ev.idEvent,
          dateEvent: ev.dateEvent,
          strTime: ev.strTime,
          strHomeTeam: ev.strHomeTeam,
          strAwayTeam: ev.strAwayTeam,
          idHomeTeam: ev.idHomeTeam,
          idAwayTeam: ev.idAwayTeam,
          homeBadgeUrl: ev.homeBadgeUrl || null,
          awayBadgeUrl: ev.awayBadgeUrl || null,
          canal_oficial: ev.canal_oficial || null
        };
      }
      // players mode
      return {
        idEvent: ev.idEvent,
        dateEvent: ev.dateEvent,
        strTime: ev.strTime,
        strHomeTeam: ev.strHomeTeam,
        strAwayTeam: ev.strAwayTeam,
        idHomeTeam: ev.idHomeTeam,
        idAwayTeam: ev.idAwayTeam,
        homeBadgeUrl: ev.homeBadgeUrl || null,
        awayBadgeUrl: ev.awayBadgeUrl || null,
        players: ev.players || [],
        canal_oficial: ev.canal_oficial || null
      };
    });
    res.json({ success: true, league: slug, mode, events: sliced });
  } catch (e) {
    logError({ msg: 'banner failed', league: slug, err: e.message });
    res.status(500).json({ success: false, error: 'failed to build banner data' });
  }
});

export default router;

export { FootballDataService };
