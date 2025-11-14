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
// 🔥 Firebase Admin
const serviceAccount = path.join(
  dirname(fileURLToPath(import.meta.url)),
  "orion-lab-a9298-firebase-adminsdk-fbsvc-2111a1d5f0.json"
);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://orion-lab-a9298-default-rtdb.firebaseio.com"
  });
}

const db = getFirestore();

// -------------------------
// 🔹 Teste rápido do Firestore
(async () => {
  try {
    await db.collection("teste").doc("abc").set({ foo: "bar" });
    console.log("✅ Firestore funcionando!");
  } catch (err) {
    console.error("❌ Firestore ERRO na inicialização:", err);
  }
})();

// -------------------------
// 🌟 Inicialização do app
const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json({ limit: "50mb" }));

// -------------------------
// 🌐 Servir o Frontend
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
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
// 🖼️ GERAR BANNER – usando logo automática do Firebase
app.post("/api/gerar-banner", async (req, res) => {
  try {
    const { uid, tipo, modeloCor, posterUrl, titulo, sinopse, genero, ano, duracao } = req.body;

    if (!uid || typeof uid !== "string")
      return res.status(400).json({ error: "UID inválido." });

    // 🔥 Buscar dados do cliente na coleção correta
    const snap = await db.collection("usuarios").doc(uid).get();
    if (!snap.exists) return res.status(404).json({ error: "Usuário não encontrado." });

    const userData = snap.data();
    const logoUrl = userData.logo;

    if (!logoUrl)
      return res.status(400).json({ error: "Usuário não possui uma logo configurada." });

    if (!posterUrl)
      return res.status(400).json({ error: "Poster não informado." });

    // 🎨 Backgrounds
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
    const backgroundUrl = backgrounds[modeloCor?.toUpperCase()];
    if (!backgroundUrl)
      return res.status(400).json({ error: `Background não encontrado: ${modeloCor}` });

    // ⚡ Baixar imagens
    const [bgBuffer, posterBuffer, logoBuffer] = await Promise.all([
      fetchBuffer(backgroundUrl),
      fetchBuffer(posterUrl),
      fetchBuffer(logoUrl)
    ]);

    const dimensoes = tipo === "vertical" ? { w: 1080, h: 1920 } : { w: 1920, h: 1080 };

    // 🔹 Poster ajustado
    const posterWidth = 540;
    const posterHeight = 850;
    const posterLeft = (dimensoes.w - posterWidth) / 2;
    const posterTop = 190;

    const posterSharp = await sharp(posterBuffer)
      .resize(posterWidth, posterHeight, { fit: "cover" })
      .png()
      .toBuffer();

    // 🔹 Logo
    const logoSharp = await sharp(logoBuffer)
      .resize(150, 150)
      .png()
      .toBuffer();

    // 🔹 Texto SVG
    const wrappedSinopse = sinopse
      ?.replace(/(.{0,40})(\s|$)/g, '$1\n')
      .trim() || "";

    const textoSvg = Buffer.from(`
      <svg width="${dimensoes.w}" height="${dimensoes.h}">
        <style>
          .titulo { fill: white; font-size: 70px; font-weight: 900; font-family: 'Bebas Neue', sans-serif; }
          .sinopse { fill: white; font-size: 40px; font-family: 'Open Sans', sans-serif; }
          .info { fill: rgba(230,230,230,0.95); font-size: 36px; font-family: 'Open Sans', sans-serif; font-weight: bold; }
        </style>
        <text x="50%" y="1345" text-anchor="middle" class="titulo">${titulo}</text>
        <text x="50%" y="1410" text-anchor="middle" class="sinopse">
          ${wrappedSinopse.split("\n").map((line, i) =>
            `<tspan x="50%" dy="${i === 0 ? 0 : 60}">${line}</tspan>`
          ).join('')}
        </text>
        <text x="50%" y="1700" text-anchor="middle" class="info">
          ${genero} • ${ano} • ${duracao}
        </text>
      </svg>
    `);

    // 🔹 Escurecimento suave
    const overlaySvg = Buffer.from(`<svg width="${dimensoes.w}" height="${dimensoes.h}"><rect width="100%" height="100%" fill="rgba(0,0,0,0.25)" /></svg>`);

    // 🧩 Montagem final
    const banner = await sharp(bgBuffer)
      .resize(dimensoes.w, dimensoes.h)
      .composite([
        { input: overlaySvg, blend: "over" },
        { input: posterSharp, top: posterTop, left: posterLeft },
        { input: logoSharp, top: 40, left: dimensoes.w - 190 },
        { input: textoSvg, blend: "over" }
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
