import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

// Mapear ligas para códigos Football-Data.org
const leagueCodes = {
  "WC": "WC",        // FIFA World Cup
  "CL": "CL",        // UEFA Champions League
  "BL1": "BL1",      // Bundesliga
  "DED": "DED",      // Eredivisie
  "BSA": "BSA",      // Campeonato Brasileiro Série A
  "PD": "PD",        // Primera Division
  "FL1": "FL1",      // Ligue 1
  "ELC": "ELC",      // Championship
  "PPL": "PPL",      // Primeira Liga
  "EC": "EC",        // European Championship
  "SA": "SA",        // Serie A (Itália)
  "PL": "PL"         // Premier League
};

app.get("/api/jogos", async (req, res) => {
  const leagueCode = req.query.league || "BSA";

  try {
    const response = await fetch(
      `https://api.football-data.org/v4/competitions/${leagueCode}/matches`,
      {
        headers: {
          "X-Auth-Token": process.env.FOOTBALL_KEY
        }
      }
    );

    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ error: err });
    }

    const data = await response.json();

    // Pega a rodada atual (matchday) ou usa 1 como fallback
    const matchday = data.filters?.matchday || (data.matches[0]?.matchday) || 1;

    // Filtra apenas os jogos da rodada atual
    const jogosRodada = data.matches.filter(m => m.matchday === matchday);

    res.json({
      competition: data.competition,
      matchday,
      matches: jogosRodada
    });

  } catch (error) {
    console.error("Erro ao buscar API:", error);
    res.status(500).json({ error: "Erro ao carregar jogos" });
  }
});

app.listen(PORT, () => console.log(`🔥 Servidor rodando na porta ${PORT}`));
