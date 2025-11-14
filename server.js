// 🌟 Importações
import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import multer from "multer";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import cloudinary from "./api/cloudinary.js";
import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

import {
  buscarTMDB,
  getLancamentos,
  getFilmesPopulares,
  getSeriesPopulares,
  getTendencias
} from "./api/tmdb.js";

import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";

dotenv.config();

// -------------------------
// 🔥 Firebase Admin (JSON na raiz)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 🔥 Firebase Admin usando JSON direto do .env
let serviceAccount = null;

try {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} catch (err) {
  console.error("❌ Erro ao fazer parse do FIREBASE_SERVICE_ACCOUNT no .env");
  console.error("Conteúdo recebido:", process.env.FIREBASE_SERVICE_ACCOUNT);
  throw err;
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = getFirestore();

// -------------------------
// 🌟 Inicialização do app
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "50mb" }));

// -------------------------
// 🌐 Servir o Frontend
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// -------------------------
// ⚽ API de Futebol
const leagueCodes = {
  WC: "WC", CL: "CL", BL1: "BL1", DED: "DED", BSA: "BSA",
  PD: "PD", FL1: "FL1", ELC: "ELC", PPL: "PPL", EC: "EC",
  SA: "SA", PL: "PL",
};

app.get("/api/jogos", async (req, res) => {
  const leagueCode = req.query.league || "BSA";

  try {
    const response = await fetch(
      `https://api.football-data.org/v4/competitions/${leagueCode}/matches`,
      { headers: { "X-Auth-Token": process.env.FOOTBALL_KEY } }
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
app.get("/api/tmdb", async (req, res) => {
  const { query, tipo } = req.query;

  try {
    if (query) {
      const resultados = await buscarTMDB(query, tipo || "movie");
      return res.json(resultados);
    }

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
// 🔹 Detalhes TMDB
app.get("/api/tmdb/detalhes/:tipo/:id", async (req, res) => {
  const { tipo, id } = req.params;

  try {
    const response = await fetch(
      `https://api.themoviedb.org/3/${tipo}/${id}?api_key=${process.env.TMDB_KEY}&language=pt-BR`
    );

    if (!response.ok) {
      return res.status(response.status).json({ error: "Item não encontrado na TMDB" });
    }

    const item = await response.json();
    res.json(item);
  } catch (err) {
    console.error("❌ Erro ao buscar detalhes da TMDB:", err);
    res.status(500).json({ error: "Erro ao buscar detalhes da TMDB" });
  }
});

// -------------------------
// ☁️ Cloudinary + Multer
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "orioncreator",
    allowed_formats: ["jpg", "png", "jpeg", "webp"],
  },
});

const upload = multer({ storage });

app.post("/api/upload", upload.single("file"), (req, res) => {
  res.json({ url: req.file.path || req.file.url });
});

// -------------------------
// 🔥 Função auxiliar
async function fetchBuffer(url) {
  if (!url) throw new Error("URL inválida: " + url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha ao baixar imagem: ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer || buffer.length === 0) throw new Error(`Buffer vazio: ${url}`);
  return buffer;
}

// -------------------------
// 🖼️ GERAR BANNER
app.post("/api/gerar-banner", async (req, res) => {
  try {
    const { uid, tipo, modeloCor, posterUrl, titulo, sinopse, genero, ano, duracao } = req.body;

    if (!uid) return res.status(400).json({ error: "UID inválido." });

    const snap = await db.collection("usuarios").doc(uid).get();
    if (!snap.exists) return res.status(404).json({ error: "Usuário não encontrado." });

    const userData = snap.data();

    const logoUrl = userData.logo;
    if (!logoUrl) return res.status(400).json({ error: "Usuário não possui logo configurada." });

    // 🔥 Backgrounds
    const verticalBanners = {
      "ROXO": "https://res.cloudinary.com/dxbu3zk6i/image/upload/v1762868011/vertical_roxo_hmse9c.png",
      "AZUL": "https://res.cloudinary.com/dxbu3zk6i/image/upload/v1762868011/vertical_azul_qdlxzx.png",
      "VERMELHO": "https://res.cloudinary.com/dxbu3zk6i/image/upload/v1762868008/vertical_vermelho_r68hct.png",
      "VERDE": "https://res.cloudinary.com/dxbu3zk6i/image/upload/v1762868010/vertical_verde_ylxm0x.png",
      "PRATA": "https://res.cloudinary.com/dxbu3zk6i/image/upload/v1762868008/vertical_prata_fxp1xt.png",
      "AMARELO": "https://res.cloudinary.com/dxbu3zk6i/image/upload/v1762866810/orioncreator/dsh5nkghf7eisqboa5pv.png",
      "DOURADO": "https://res.cloudinary.com/dxbu3zk6i/image/upload/v1762868008/vertical_dourado_po9uqt.png",
      "LARANJA": "https://res.cloudinary.com/dxbu3zk6i/image/upload/v1762868009/vertical_lajanja_pkwbvv.png"
    };

    const backgrounds = tipo === "vertical" ? verticalBanners : {};
    const bgUrl = backgrounds[modeloCor?.toUpperCase()];

    if (!bgUrl) return res.status(400).json({ error: `Background não encontrado: ${modeloCor}` });

    // 🔥 Baixar imagens
    const [bgBuffer, posterBuffer, logoBuffer] = await Promise.all([
      fetchBuffer(bgUrl),
      fetchBuffer(posterUrl),
      fetchBuffer(logoUrl)
    ]);

    const dims = tipo === "vertical" ? { w: 1080, h: 1920 } : { w: 1920, h: 1080 };

    // 🔹 Poster
    const posterSharp = await sharp(posterBuffer)
      .resize(540, 850)
      .png()
      .toBuffer();

    // 🔹 Logo
    const logoSharp = await sharp(logoBuffer)
      .resize(150, 150)
      .png()
      .toBuffer();

    // 🔹 Texto
    const wrappedSinopse = sinopse?.replace(/(.{0,40})(\s|$)/g, '$1\n').trim() || "";

    const textoSvg = Buffer.from(`
      <svg width="${dims.w}" height="${dims.h}">
        <style>
          .titulo { fill: white; font-size: 70px; font-weight: 900; font-family: 'Bebas Neue'; }
          .sinopse { fill: white; font-size: 40px; font-family: 'Open Sans'; }
          .info { fill: rgba(230,230,230,0.95); font-size: 36px; font-family: 'Open Sans'; font-weight: bold; }
        </style>
        <text x="50%" y="1345" text-anchor="middle" class="titulo">${titulo}</text>
        <text x="50%" y="1410" text-anchor="middle" class="sinopse">
          ${wrappedSinopse.split("\n").map((line, i) =>
            `<tspan x="50%" dy="${i === 0 ? 0 : 60}">${line}</tspan>`
          ).join("")}
        </text>
        <text x="50%" y="1700" text-anchor="middle" class="info">
          ${genero} • ${ano} • ${duracao}
        </text>
      </svg>
    `);

    // 🔹 Escurecimento
    const overlay = Buffer.from(
      `<svg width="${dims.w}" height="${dims.h}">
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.25)"/>
      </svg>`
    );

    // 🧩 Montagem
    const banner = await sharp(bgBuffer)
      .resize(dims.w, dims.h)
      .composite([
        { input: overlay },
        { input: posterSharp, top: 190, left: (dims.w - 540) / 2 },
        { input: logoSharp, top: 40, left: dims.w - 190 },
        { input: textoSvg }
      ])
      .png()
      .toBuffer();

    res.setHeader("Content-Disposition", `attachment; filename=banner_${tipo}.png`);
    res.setHeader("Content-Type", "image/png");
    res.send(banner);

  } catch (err) {
    console.error("❌ Erro ao gerar banner:", err);
    res.status(500).json({ error: err.message || "Erro ao gerar banner" });
  }
});

// 🚀 Inicialização
app.listen(PORT, () => {
  console.log(`🔥 Servidor rodando em: http://localhost:${PORT}`);
});
