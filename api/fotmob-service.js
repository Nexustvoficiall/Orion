import express from 'express';
import fetch from 'node-fetch';

const router = express.Router();

// Cache simples em memória
const cache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutos

function getCached(key) {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  cache.delete(key);
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
}

// Buscar jogos por data
async function getMatchesByDate(date) {
  const cacheKey = `matches_${date}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const url = `https://www.fotmob.com/api/matches?date=${date}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`FotMob API error: ${response.status}`);
    }

    const data = await response.json();
    setCache(cacheKey, data);
    return data;
  } catch (error) {
    console.error('❌ Erro FotMob getMatchesByDate:', error.message);
    return null;
  }
}

// Buscar detalhes de um jogo específico
async function getMatchDetails(matchId) {
  const cacheKey = `match_${matchId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const url = `https://www.fotmob.com/api/matchDetails?matchId=${matchId}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`FotMob API error: ${response.status}`);
    }

    const data = await response.json();
    setCache(cacheKey, data);
    return data;
  } catch (error) {
    console.error('❌ Erro FotMob getMatchDetails:', error.message);
    return null;
  }
}

// Buscar informações de time
async function getTeamInfo(teamId) {
  const cacheKey = `team_${teamId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const url = `https://www.fotmob.com/api/teams?id=${teamId}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`FotMob API error: ${response.status}`);
    }

    const data = await response.json();
    setCache(cacheKey, data);
    return data;
  } catch (error) {
    console.error('❌ Erro FotMob getTeamInfo:', error.message);
    return null;
  }
}

// Mapeamento de ligas brasileiras e internacionais
const LIGAS_IMPORTANTES = {
  // Brasil
  '325': 'Brasileirão Série A',
  '390': 'Copa do Brasil',
  '2210': 'Campeonato Carioca',
  '2223': 'Campeonato Paulista',
  '2229': 'Campeonato Gaúcho',
  
  // Europa
  '47': 'Premier League',
  '87': 'La Liga',
  '54': 'Bundesliga',
  '53': 'Serie A',
  '55': 'Ligue 1',
  '42': 'Champions League',
  '73': 'Europa League',
  
  // América do Sul
  '384': 'Libertadores',
  '385': 'Sul-Americana',
  '2127': 'Campeonato Argentino'
};

// Endpoint: Jogos de hoje
router.get('/jogos-hoje', async (req, res) => {
  try {
    const hoje = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    console.log(`📅 Buscando jogos FotMob para ${hoje}`);

    const data = await getMatchesByDate(hoje);
    
    if (!data || !data.leagues) {
      return res.json({ 
        success: true, 
        date: hoje,
        total: 0,
        events: []
      });
    }

    const jogosHoje = [];

    // Iterar pelas ligas
    for (const league of data.leagues) {
      const leagueId = league.id?.toString();
      const leagueName = league.name || 'Desconhecida';
      
      // Filtrar apenas ligas importantes (opcional)
      // if (!LIGAS_IMPORTANTES[leagueId]) continue;

      if (!league.matches || league.matches.length === 0) continue;

      for (const match of league.matches) {
        // Extrair informações do jogo
        const horario = match.status?.utcTime || match.status?.startTimeStr || '--:--';
        
        jogosHoje.push({
          idEvent: match.id?.toString(),
          dateEvent: hoje,
          strTime: horario,
          strHomeTeam: match.home?.name || 'Time Casa',
          strAwayTeam: match.away?.name || 'Time Visitante',
          idHomeTeam: match.home?.id?.toString(),
          idAwayTeam: match.away?.id?.toString(),
          homeBadgeUrl: `https://images.fotmob.com/image_resources/logo/teamlogo/${match.home?.id}_small.png`,
          awayBadgeUrl: `https://images.fotmob.com/image_resources/logo/teamlogo/${match.away?.id}_small.png`,
          strLeague: leagueName,
          idLeague: leagueId,
          slug_liga: leagueName.toLowerCase().replace(/\s+/g, '_'),
          canal_oficial: null, // FotMob não tem info de canal
          players: [] // Será preenchido depois se necessário
        });
      }
    }

    // Ordenar por horário
    jogosHoje.sort((a, b) => {
      if (a.strTime && b.strTime) {
        return a.strTime.localeCompare(b.strTime);
      }
      return 0;
    });

    console.log(`✅ FotMob: ${jogosHoje.length} jogos encontrados`);

    res.json({ 
      success: true, 
      date: hoje,
      total: jogosHoje.length,
      events: jogosHoje
    });
  } catch (error) {
    console.error('❌ Erro em /jogos-hoje:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro ao buscar jogos do FotMob' 
    });
  }
});

// Endpoint: Detalhes de um jogo (com jogadores)
router.get('/match/:id', async (req, res) => {
  try {
    const matchId = req.params.id;
    const details = await getMatchDetails(matchId);
    
    if (!details) {
      return res.status(404).json({ 
        success: false, 
        error: 'Jogo não encontrado' 
      });
    }

    res.json({ 
      success: true, 
      data: details 
    });
  } catch (error) {
    console.error('❌ Erro em /match/:id:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro ao buscar detalhes do jogo' 
    });
  }
});

// Endpoint: Informações de time
router.get('/team/:id', async (req, res) => {
  try {
    const teamId = req.params.id;
    const teamInfo = await getTeamInfo(teamId);
    
    if (!teamInfo) {
      return res.status(404).json({ 
        success: false, 
        error: 'Time não encontrado' 
      });
    }

    res.json({ 
      success: true, 
      data: teamInfo 
    });
  } catch (error) {
    console.error('❌ Erro em /team/:id:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro ao buscar informações do time' 
    });
  }
});

export default router;
