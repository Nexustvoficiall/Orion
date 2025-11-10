async function carregarVods() {
  const container = document.querySelector("#lista-vods");
  container.innerHTML = "<p style='color:white;'>⏳ Carregando conteúdo...</p>";

  try {
    const res = await fetch("/api/tmdb"); // rota do servidor
    if (!res.ok) throw new Error(`Erro HTTP ${res.status}`);
    const data = await res.json();

    console.log("🎬 Dados recebidos:", data);

    container.innerHTML = "";

    // Exibir seções
    mostrarSecao(container, "🎥 Lançamentos (Filmes)", data.filmesLancamentos);
    mostrarSecao(container, "📺 Lançamentos (Séries)", data.seriesLancamentos);
    mostrarSecao(container, "🔥 Filmes Populares", data.filmesPopulares);
    mostrarSecao(container, "⭐ Séries Populares", data.seriesPopulares);
    mostrarSecao(container, "🚀 Tendências", data.tendencias);

    // Caso nada tenha vindo
    if (!container.innerHTML.trim()) {
      container.innerHTML = "<p style='color:white;'>⚠️ Nenhum conteúdo disponível no momento.</p>";
    }

  } catch (err) {
    console.error("❌ Erro ao carregar VODs:", err);
    container.innerHTML = "<p style='color:red;'>Erro ao carregar VODs. Verifique o servidor.</p>";
  }
}

function mostrarSecao(container, titulo, lista) {
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
    grade.appendChild(card);
  });

  secao.appendChild(grade);
  container.appendChild(secao);
}

// Inicia ao carregar a página
document.addEventListener("DOMContentLoaded", carregarVods);
