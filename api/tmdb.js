import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

// 🧩 Corrigido: variável igual à do .env
const TMDB_API_KEY = process.env.TMDB_KEY; // 🔹 antes estava TMDB_API_KEY
const TMDB_BASE_URL = "https://api.themoviedb.org/3";

// 🔍 Buscar filmes ou séries por nome
export async function buscarTMDB(query, tipo = "movie") {
  try {
    const url = `${TMDB_BASE_URL}/search/${tipo}?api_key=${TMDB_API_KEY}&language=pt-BR&query=${encodeURIComponent(query)}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error("Erro na resposta da API TMDB");
    const data = await response.json();
    return data.results || [];
  } catch (err) {
    console.error("❌ Erro ao buscar na TMDB:", err);
    return [];
  }
}

// 🚀 Lançamentos (filmes e séries recentes)
export async function getLancamentos() {
  try {
    const [filmes, series] = await Promise.all([
      fetch(`${TMDB_BASE_URL}/movie/now_playing?api_key=${TMDB_API_KEY}&language=pt-BR&page=1`).then(r => r.json()),
      fetch(`${TMDB_BASE_URL}/tv/on_the_air?api_key=${TMDB_API_KEY}&language=pt-BR&page=1`).then(r => r.json())
    ]);

    return {
      filmes: filmes.results || [],
      series: series.results || []
    };
  } catch (err) {
    console.error("❌ Erro ao listar lançamentos:", err);
    return { filmes: [], series: [] };
  }
}

// ⭐ Filmes populares (em destaque)
export async function getFilmesPopulares() {
  try {
    const response = await fetch(`${TMDB_BASE_URL}/movie/popular?api_key=${TMDB_API_KEY}&language=pt-BR&page=1`);
    if (!response.ok) throw new Error("Erro na resposta de filmes populares");
    const data = await response.json();
    return data.results || [];
  } catch (err) {
    console.error("❌ Erro ao listar filmes populares:", err);
    return [];
  }
}

// 📺 Séries populares (em destaque)
export async function getSeriesPopulares() {
  try {
    const response = await fetch(`${TMDB_BASE_URL}/tv/popular?api_key=${TMDB_API_KEY}&language=pt-BR&page=1`);
    if (!response.ok) throw new Error("Erro na resposta de séries populares");
    const data = await response.json();
    return data.results || [];
  } catch (err) {
    console.error("❌ Erro ao listar séries populares:", err);
    return [];
  }
}

// 🔥 Tendências (em alta - filmes e séries mais vistos do dia)
export async function getTendencias() {
  try {
    const response = await fetch(`${TMDB_BASE_URL}/trending/all/day?api_key=${TMDB_API_KEY}&language=pt-BR`);
    if (!response.ok) throw new Error("Erro ao buscar tendências");
    const data = await response.json();
    return data.results || [];
  } catch (err) {
    console.error("❌ Erro ao listar tendências:", err);
    return [];
  }
}
// 🎬 Detalhes de um filme ou série pelo ID
export async function getDetalhes(id, tipo = "movie") {
  try {
    const response = await fetch(`${TMDB_BASE_URL}/${tipo}/${id}?api_key=${TMDB_API_KEY}&language=pt-BR&append_to_response=images`);
    if (!response.ok) throw new Error("Erro ao buscar detalhes na TMDB");
    const data = await response.json();
    return data;
  } catch (err) {
    console.error("❌ Erro ao buscar detalhes:", err);
    return null;
  }
}
