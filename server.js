import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import {
  buscarTMDB,
  getLancamentos,
  getFilmesPopulares,
  getSeriesPopulares,
  getTendencias
} from "./api/tmdb.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

// -------------------------
// ⚽ API de Futebol
// -------------------------
const leagueCodes = {
  WC: "WC",
  CL: "CL",
  BL1: "BL1",
  DED: "DED",
  BSA: "BSA",
  PD: "PD",
  FL1: "FL1",
  ELC: "ELC",
  PPL: "PPL",
  EC: "EC",
  SA: "SA",
  PL: "PL",
};

app.get("/api/jogos", async (req, res) => {
  const leagueCode = req.query.league || "BSA";

  try {
    const response = await fetch(
      `https://api.football-data.org/v4/competitions/${leagueCode}/matches`,
      {
        headers: { "X-Auth-Token": process.env.FOOTBALL_KEY },
      }
    );

    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ error: err });
    }

    const data = await response.json();
    const matchday = data.filters?.matchday || data.matches[0]?.matchday || 1;
    const jogosRodada = data.matches.filter((m) => m.matchday === matchday);

    res.json({
      competition: data.competition,
      matchday,
      matches: jogosRodada,
    });
  } catch (error) {
    console.error("❌ Erro ao buscar API de futebol:", error);
    res.status(500).json({ error: "Erro ao carregar jogos" });
  }
});

// -------------------------
// 🎬 API TMDB (Filmes e Séries)
// -------------------------
app.get("/api/tmdb", async (req, res) => {
  const { query, tipo } = req.query;

  try {
    // 🔍 Caso o usuário faça uma busca manual
    if (query) {
      const resultados = await buscarTMDB(query, tipo || "movie");
      return res.json(resultados);
    }

    // 🚀 Caso seja carregamento automático (sem query)
    const [lancamentos, filmesPop, seriesPop, tendencias] = await Promise.all([
      getLancamentos(),
      getFilmesPopulares(),
      getSeriesPopulares(),
      getTendencias()
    ]);

    return res.json({
      filmesLancamentos: lancamentos?.filmes || [],
      seriesLancamentos: lancamentos?.series || [],
      filmesPopulares: filmesPop || [],
      seriesPopulares: seriesPop || [],
      tendencias: tendencias || []
    });

  } catch (err) {
    console.error("❌ Erro ao buscar dados da TMDB:", err);
    res.status(500).json({ error: "Erro ao buscar dados da TMDB" });
  }
});

// -------------------------
// 🚀 Inicialização do servidor
// -------------------------
app.listen(PORT, () => {
  console.log(`🔥 Servidor rodando em: http://localhost:${PORT}`);
});
