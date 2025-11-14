// -------------------------
// vods.js - versão final corrigida (poster visível e modal estável)
// -------------------------

// 🌟 Variáveis globais
let capasFilme = [];
let capaIndex = 0;
let chosenBannerUrl = null;
let selectedPosterForGeneration = null;
let currentOrientation = "vertical";
const coresBanners = ["ROXO", "AZUL", "VERMELHO", "DOURADO", "AMARELO", "LARANJA", "VERDE", "PRATA"];

// -------------------------
// 🌟 Carregar VODs
// -------------------------
async function carregarVods() {
  const container = document.querySelector("#lista-vods");
  if (!container) return;
  container.innerHTML = "<p style='color:white;'>⏳ Carregando conteúdo...</p>";

  try {
    const res = await fetch("/api/tmdb");
    if (!res.ok) throw new Error(`Erro HTTP ${res.status}`);
    const data = await res.json();

    console.log("🎬 Dados recebidos:", data);
    container.innerHTML = "";

    mostrarSecao(container, "🎥 Lançamentos (Filmes)", data.filmesLancamentos, "movie");
    mostrarSecao(container, "📺 Lançamentos (Séries)", data.seriesLancamentos, "tv");
    mostrarSecao(container, "🔥 Filmes Populares", data.filmesPopulares, "movie");
    mostrarSecao(container, "⭐ Séries Populares", data.seriesPopulares, "tv");
    mostrarSecao(container, "🚀 Tendências", data.tendencias);

    if (!container.innerHTML.trim()) {
      container.innerHTML = "<p style='color:white;'>⚠️ Nenhum conteúdo disponível no momento.</p>";
    }
  } catch (err) {
    console.error("❌ Erro ao carregar VODs:", err);
    container.innerHTML = "<p style='color:red;'>Erro ao carregar VODs. Verifique o servidor.</p>";
  }
}

// -------------------------
// 🌟 Mostrar cada seção
// -------------------------
function mostrarSecao(container, titulo, lista, tipo) {
  if (!lista || lista.length === 0) return;

  const secao = document.createElement("div");
  secao.style.marginBottom = "30px";
  secao.innerHTML = `<h2 style="color:#00bfff;">${titulo}</h2>`;

  const grade = document.createElement("div");
  grade.style.display = "flex";
  grade.style.flexWrap = "wrap";
  grade.style.gap = "10px";

  lista.forEach(item => {
    const poster = item.poster_path
      ? `https://image.tmdb.org/t/p/w300${item.poster_path}`
      : "https://via.placeholder.com/300x450?text=Sem+Imagem";

    const card = document.createElement("div");
    card.style.width = "150px";
    card.style.textAlign = "center";
    card.style.color = "#fff";
    card.style.cursor = "pointer";
    card.style.transition = "transform 0.2s ease";
    card.onmouseover = () => (card.style.transform = "scale(1.05)");
    card.onmouseout = () => (card.style.transform = "scale(1)");

    card.innerHTML = `
      <img src="${poster}" style="width:100%;border-radius:10px;box-shadow:0 0 10px rgba(0,0,0,0.5);">
      <p style="font-size:14px;margin-top:5px;">${item.title || item.name}</p>
    `;

    card.addEventListener("click", () => abrirDetalhesBanner(item.id, tipo));
    grade.appendChild(card);
  });

  secao.appendChild(grade);
  container.appendChild(secao);
}

// -------------------------
// 🌟 Abrir modalBanner com detalhes
// -------------------------
async function abrirDetalhesBanner(id, tipo) {
  try {
    const modal = document.getElementById("modalBanner");
    const posterEl = document.getElementById("posterDetalhesBanner");
    const posterContainer = document.getElementById("posterContainerBanner");
    const tituloEl = document.getElementById("tituloDetalhesBanner");
    const sinopseEl = document.getElementById("sinopseDetalhesBanner");
    const capasContainer = document.getElementById("capasContainerBanner");
    const coresContainer = document.getElementById("coresContainerBanner");
    const previewBanner = document.getElementById("previewBannerBanner");
    const baixarBtn = document.getElementById("baixarBannerBtn");
    const visualizarBtn = document.getElementById("visualizarPreviewBtn");

    // Reset visual
    posterEl.src = "";
    tituloEl.textContent = "Carregando...";
    sinopseEl.textContent = "";
    capasContainer.innerHTML = "";
    coresContainer.style.display = "none";
    coresContainer.innerHTML = "";
    previewBanner.style.display = "none";
    previewBanner.src = "";
    if (baixarBtn) baixarBtn.style.display = "none";
    if (visualizarBtn) visualizarBtn.style.display = "none";

    capasFilme = [];
    capaIndex = 0;
    chosenBannerUrl = null;
    selectedPosterForGeneration = null;

    // garante visibilidade
    posterContainer.style.display = "flex";
    modal.style.display = "flex";
    modal.setAttribute("aria-hidden", "false");

    // busca detalhes
    const res = await fetch(`/api/tmdb/detalhes/${tipo}/${id}?nocache=${Date.now()}`);
    if (!res.ok) throw new Error(`Erro ao buscar detalhes: ${res.status}`);
    const item = await res.json();

    tituloEl.textContent = item.title || item.name || "—";
    sinopseEl.textContent = item.overview || "Sem descrição disponível.";
    posterEl.src = item.poster_path
      ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
      : "https://via.placeholder.com/500x750?text=Sem+Imagem";
    selectedPosterForGeneration = posterEl.src;

    // busca imagens extras
    let imgData = { backdrops: [], posters: [] };
    try {
      const imgRes = await fetch(`https://api.themoviedb.org/3/${tipo}/${id}/images?api_key=9e83568de6433adf5b84e15c8264f2fc`);
      if (imgRes.ok) imgData = await imgRes.json();
    } catch (e) {
      console.warn("⚠️ Falha ao buscar imagens extras:", e);
    }

    const postersArr = [
      ...(imgData.posters?.map(p => p.file_path) || []),
      ...(imgData.backdrops?.map(b => b.file_path) || [])
    ];

    capasFilme = [item.poster_path, ...postersArr].filter(Boolean).slice(0, 12);
    if (!capasFilme.length) capasFilme = [item.poster_path || ""];

    // preencher thumbs
    capasContainer.innerHTML = "";
    capasFilme.forEach((c, i) => {
      const thumb = document.createElement("img");
      thumb.src = c.startsWith("http") ? c : `https://image.tmdb.org/t/p/w500${c}`;
      thumb.alt = `capa ${i + 1}`;
      thumb.style.cursor = "pointer";
      thumb.style.height = "80px";
      thumb.style.borderRadius = "6px";
      thumb.style.marginRight = "8px";
      thumb.dataset.index = i;
      thumb.addEventListener("click", () => {
        capaIndex = i;
        atualizarCapa();
        document.querySelectorAll("#capasContainerBanner img").forEach(el => el.classList.remove("selected"));
        thumb.classList.add("selected");
      });
      if (i === 0) thumb.classList.add("selected");
      capasContainer.appendChild(thumb);
    });

    capaIndex = 0;
    atualizarCapa();

    const prevBtn = document.getElementById("prevCapaBtn");
    const nextBtn = document.getElementById("nextCapaBtn");

    if (prevBtn)
      prevBtn.onclick = () => {
        if (!capasFilme.length) return;
        capaIndex = (capaIndex - 1 + capasFilme.length) % capasFilme.length;
        atualizarCapa();
        document.querySelectorAll("#capasContainerBanner img").forEach(el => el.classList.remove("selected"));
        document.querySelectorAll("#capasContainerBanner img")[capaIndex]?.classList.add("selected");
      };

    if (nextBtn)
      nextBtn.onclick = () => {
        if (!capasFilme.length) return;
        capaIndex = (capaIndex + 1) % capasFilme.length;
        atualizarCapa();
        document.querySelectorAll("#capasContainerBanner img").forEach(el => el.classList.remove("selected"));
        document.querySelectorAll("#capasContainerBanner img")[capaIndex]?.classList.add("selected");
      };

    console.log("✅ Modal aberto para:", tituloEl.textContent);
  } catch (err) {
    console.error("❌ Erro ao abrir modal:", err);
    alert("Não foi possível carregar os detalhes. Veja o console.");
  }
}

// -------------------------
// 🌟 Atualizar capa principal
// -------------------------
function atualizarCapa() {
  if (!capasFilme.length) return;
  const poster = document.getElementById("posterDetalhesBanner");
  const path = capasFilme[capaIndex] || "";
  poster.src = path.startsWith("http") ? path : `https://image.tmdb.org/t/p/w500${path}`;
  selectedPosterForGeneration = poster.src;
}

// -------------------------
// 🌟 Fechar modal
// -------------------------
function fecharModalBanner() {
  const modal = document.getElementById("modalBanner");
  if (!modal) return;
  modal.style.display = "none";
  modal.setAttribute("aria-hidden", "true");
  document.getElementById("posterDetalhesBanner").src = "";
  document.getElementById("tituloDetalhesBanner").textContent = "";
  document.getElementById("sinopseDetalhesBanner").textContent = "";
  const capasContainer = document.getElementById("capasContainerBanner");
  if (capasContainer) capasContainer.innerHTML = "";
  const coresContainer = document.getElementById("coresContainerBanner");
  if (coresContainer) {
    coresContainer.style.display = "none";
    coresContainer.innerHTML = "";
  }
  const preview = document.getElementById("previewBannerBanner");
  if (preview) {
    preview.style.display = "none";
    preview.src = "";
  }
  const baixarBtn = document.getElementById("baixarBannerBtn");
  if (baixarBtn) baixarBtn.style.display = "none";

  capasFilme = [];
  capaIndex = 0;
  chosenBannerUrl = null;
  selectedPosterForGeneration = null;
}

// -------------------------
// 🌟 Mostrar cores
// -------------------------
function mostrarCoresBanner(orientation = "vertical") {
  try {
    currentOrientation = orientation === "horizontal" ? "horizontal" : "vertical";
    const coresContainer = document.getElementById("coresContainerBanner");
    if (!coresContainer) return;

    coresContainer.innerHTML = "";
    coresContainer.style.display = "flex";
    coresContainer.style.gap = "10px";
    coresContainer.style.flexWrap = "wrap";
    coresContainer.style.justifyContent = "center";
    coresContainer.style.marginTop = "12px";

    coresBanners.forEach(c => {
      const img = document.createElement("img");
      img.src = `https://res.cloudinary.com/dxbu3zk6i/image/upload/v1762866810/orioncreator/banner_${c.toLowerCase()}.png`;
      img.alt = c;
      img.title = c;
      img.style.cursor = "pointer";
      img.style.width = "140px";
      img.style.height = "200px";
      img.style.objectFit = "cover";
      img.style.borderRadius = "8px";
      img.style.border = "3px solid transparent";
      img.addEventListener("click", () => {
        document.querySelectorAll("#coresContainerBanner img").forEach(el => el.style.border = "3px solid transparent");
        img.style.border = "3px solid rgba(200,180,255,0.9)";
        chosenBannerUrl = img.src;
        const visualizarBtn = document.getElementById("visualizarPreviewBtn");
        if (visualizarBtn) visualizarBtn.style.display = "inline-block";
        gerarPreviewBanner(c, img.src);
      });
      coresContainer.appendChild(img);
    });

    const visualizarBtn = document.getElementById("visualizarPreviewBtn");
    if (visualizarBtn) visualizarBtn.style.display = "none";
  } catch (err) {
    console.error("❌ Erro em mostrarCoresBanner:", err);
  }
}

// -------------------------
// 🌟 Gerar preview
// -------------------------
function gerarPreviewBanner(corSelecionada, bannerUrl) {
  try {
    const preview = document.getElementById("previewBannerBanner");
    const botao = document.getElementById("baixarBannerBtn");
    if (!preview || !botao) return;

    preview.src = bannerUrl;
    preview.style.display = "block";
    botao.style.display = "inline-block";
    botao.href = bannerUrl;
    const titulo = (document.getElementById("tituloDetalhesBanner")?.textContent || "banner").replace(/[^\w\s-]/g, "");
    botao.download = `${titulo}_${corSelecionada}.png`;

    console.log(`Preview pronto: ${corSelecionada}`);
  } catch (err) {
    console.error("❌ Erro ao gerar preview:", err);
  }
}

// -------------------------
// 🌟 Inicialização
// -------------------------
document.addEventListener("DOMContentLoaded", () => {
  const closeBtn = document.querySelector(".close-btn");
  if (closeBtn) closeBtn.addEventListener("click", fecharModalBanner);
  carregarVods();
});
