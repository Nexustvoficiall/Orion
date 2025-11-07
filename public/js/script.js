const generateBtn = document.getElementById("generate-banner");
const optionsDiv = document.getElementById("options");
const bannerOutput = document.getElementById("banner-output");

generateBtn.addEventListener("click", () => {
  optionsDiv.style.display = "flex";
  bannerOutput.innerHTML = "";
});

function createSearchInput() {
  bannerOutput.innerHTML = `
    <div style="text-align:center; margin-top:20px;">
      <input type="text" id="searchInput" placeholder="Digite nome do filme ou série" style="padding:10px; width:70%; max-width:400px; border-radius:10px;" />
      <button id="searchBtn" style="padding:10px 20px; border-radius:10px; margin-left:10px; cursor:pointer;">Buscar</button>
    </div>
    <div id="searchResults" style="margin-top:20px;"></div>
  `;

  document.getElementById("searchBtn").addEventListener("click", async () => {
    const query = document.getElementById("searchInput").value.trim();
    if (!query) {
      document.getElementById("searchResults").innerHTML = "Por favor, digite um nome.";
      return;
    }
    document.getElementById("searchResults").innerHTML = "Carregando...";
    const data = await fetchMoviesSeries(query);
    displayMovieResults(data, document.getElementById("searchResults"));
  });
}

const optionButtons = document.querySelectorAll(".option-btn");
optionButtons.forEach(btn => {
  btn.addEventListener("click", async () => {
    const type = btn.dataset.type;
    bannerOutput.innerHTML = "";
    if (type === "moviesSeries") {
      createSearchInput();
    } else if (type === "Futebol") {
      bannerOutput.innerHTML = "Carregando Futebol...";
      const data = await fetchFootballLeagues();
      displaySportEvents(data, "Futebol");
    } else if (type === "sports") {
      bannerOutput.innerHTML = "Carregando Outros Esportes...";
      const data = await fetchOtherSports();
      displaySportEvents(data, "Outros Esportes");
    }
  });
});

// Filmes & Séries (TMDb)
async function fetchMoviesSeries(query) {
  const apiKey = "9e83568de6433adf5b84e15c8264f2fc"; // substitua pelo seu
  const url = `https://api.themoviedb.org/3/search/multi?api_key=${apiKey}&language=pt-BR&query=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url);
    const json = await res.json();
    return json.results;
  } catch (err) {
    console.error(err);
    return [];
  }
}

function displayMovieResults(results, container) {
  container.innerHTML = "";
  if (!results || results.length === 0) {
    container.innerHTML = "Nenhum resultado encontrado 😅";
    return;
  }
  results.forEach(item => {
    const title = item.title || item.name || "Sem título";
    const imagePath = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : "images/logo.png";
    const overview = item.overview ? item.overview : "Sem descrição disponível.";
    container.innerHTML += `
      <div style="margin-bottom:30px; text-align:center;">
        <h3>${title}</h3>
        <img src="${imagePath}" alt="${title}" style="width:200px; max-width:80%; border-radius:10px; margin-top:10px;" />
        <p>${overview}</p>
      </div>
    `;
  });
}

// Futebol — várias ligas
async function fetchFootballLeagues() {
  const leagueIds = [4351, 4404, 4331, 4335, 4332, 4334, 4480]; 
  const allEvents = [];
  for (const id of leagueIds) {
    try {
      const res = await fetch(`https://www.thesportsdb.com/api/v1/json/3/eventsnextleague.php?id=${id}`);
      const json = await res.json();
      if (json.events) {
        allEvents.push(...json.events);
      }
    } catch (err) {
      console.error("Erro liga", id, err);
    }
  }
  return allEvents;
}

// Outros esportes — tênis, basquete, futsal, basebol
async function fetchOtherSports() {
  const sportLeagues = [
    { sport: "Tênis", id: 4464 }, // ATP
    { sport: "Basquete", id: 4387 }, // NBA
    { sport: "Futsal", id: 4337 }, 
    { sport: "Basebol", id: 4424 } // MLB
  ];
  const allEvents = [];
  for (const league of sportLeagues) {
    try {
      const res = await fetch(`https://www.thesportsdb.com/api/v1/json/3/eventsnextleague.php?id=${league.id}`);
      const json = await res.json();
      if (json.events) {
        allEvents.push(...json.events.map(ev => ({ ...ev, sport: league.sport })));
      }
    } catch (err) {
      console.error("Erro outros esportes", league.sport, err);
    }
  }
  return allEvents;
}

function displaySportEvents(events, type) {
  if (!events || events.length === 0) {
    bannerOutput.innerHTML = "Nenhum resultado encontrado 😅";
    return;
  }
  let html = "";
  events.slice(0, 10).forEach(item => {
    html += `
      <div style="margin-bottom:20px; text-align:center;">
        <h3>${item.strEvent}</h3>
        <p>Liga: ${item.strLeague || item.sport}</p>
        <img src="${item.strBadge || item.strThumb || 'images/logo.png'}" alt="${item.strEvent}" style="width:150px; max-width:60%; border-radius:10px; margin-top:10px;" />
        <p>Data: ${item.dateEvent}</p>
        <p>Hora: ${item.strTime}</p>
      </div>
    `;
  });
  bannerOutput.innerHTML = html;
}
