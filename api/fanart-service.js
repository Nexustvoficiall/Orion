// api/fanart-service.js
import fetch from "node-fetch";

class FanartService {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseURL = "https://webservice.fanart.tv/v3";
  }

  // ==========================
  // LOGOS – FILME
  // ==========================

  async getMovieLogo(tmdbId, preferredLang = "pt") {
    try {
      const response = await fetch(
        `${this.baseURL}/movies/${tmdbId}?api_key=${this.apiKey}`,
        { timeout: 5000 }
      );

      if (!response.ok) {
        if (response.status === 404) {
          console.log(`ℹ️ Logo não encontrado para filme TMDB ID: ${tmdbId}`);
        }
        return null;
      }

      const data = await response.json();

      const logos = [];
      if (data.hdmovielogo) {
        logos.push.apply(logos, data.hdmovielogo);
      }
      if (data.movielogo) {
        logos.push.apply(logos, data.movielogo);
      }
      if (data.hdclearart) {
        logos.push.apply(logos, data.hdclearart);
      }

      if (logos.length === 0) return null;

      const langLogo = logos.find(l => l.lang === preferredLang);
      if (langLogo) {
        console.log(`✅ Logo encontrado em ${preferredLang} para filme ${tmdbId}`);
        return langLogo.url;
      }

      const enLogo = logos.find(l => l.lang === "en");
      if (enLogo) {
        console.log(`✅ Logo encontrado em inglês para filme ${tmdbId}`);
        return enLogo.url;
      }

      console.log(`✅ Logo genérico encontrado para filme ${tmdbId}`);
      return logos[0].url;
    } catch (error) {
      console.error(
        `❌ Erro ao buscar logo no Fanart.tv (filme ${tmdbId}):`,
        error.message
      );
      return null;
    }
  }

  // ==========================
  // LOGOS – SÉRIE
  // ==========================

  async getTVLogo(tvdbId, preferredLang = "pt") {
    try {
      const response = await fetch(
        `${this.baseURL}/tv/${tvdbId}?api_key=${this.apiKey}`,
        { timeout: 5000 }
      );

      if (!response.ok) {
        if (response.status === 404) {
          console.log(`ℹ️ Logo não encontrado para série TVDB ID: ${tvdbId}`);
        }
        return null;
      }

      const data = await response.json();

      const logos = [];
      if (data.hdtvlogo) {
        logos.push.apply(logos, data.hdtvlogo);
      }
      if (data.clearlogo) {
        logos.push.apply(logos, data.clearlogo);
      }
      if (data.hdclearart) {
        logos.push.apply(logos, data.hdclearart);
      }

      if (logos.length === 0) return null;

      const langLogo = logos.find(l => l.lang === preferredLang);
      if (langLogo) {
        console.log(`✅ Logo encontrado em ${preferredLang} para série ${tvdbId}`);
        return langLogo.url;
      }

      const enLogo = logos.find(l => l.lang === "en");
      if (enLogo) {
        console.log(`✅ Logo encontrado em inglês para série ${tvdbId}`);
        return enLogo.url;
      }

      console.log(`✅ Logo genérico encontrado para série ${tvdbId}`);
      return logos[0].url;
    } catch (error) {
      console.error(
        `❌ Erro ao buscar logo de série (TVDB ${tvdbId}):`,
        error.message
      );
      return null;
    }
  }

  // ==========================
  // HELPER – identificar poster "clean"
  // ==========================

  /**
   * Tenta inferir se o poster é "clean" (sem texto/título) pela URL/arquivo.
   * NÃO é perfeito, mas ajuda:
   * - inclui: clean, nocredit, textless
   * - evita: logo, title, banner, thumb
   */
  static isCleanPoster(entry) {
    if (!entry || !entry.url) return false;
    const u = entry.url.toLowerCase();
    // inclui pistas de clean
    const positive = ["clean", "nocredit", "no_credit", "textless"];
    // evita palavras que indicam título/texto
    const negative = ["logo", "title", "banner", "thumb", "icon"];

    if (negative.some(word => u.includes(word))) return false;
    if (positive.some(word => u.includes(word))) return true;

    // se vier de movieposter/tvposter normal, consideramos "talvez clean"
    return true;
  }

  static pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  /**
   * Dado um array de posters, tenta:
   * 1) clean com idioma preferido
   * 2) clean em inglês
   * 3) qualquer clean
   * 4) qualquer poster no idioma preferido
   * 5) qualquer poster em inglês
   * 6) qualquer poster
   */
  static pickBestPoster(posters, preferredLang = "pt") {
    if (!posters || posters.length === 0) return null;

    const isClean = this.isCleanPoster;
    const pick = this.pickRandom;

    const byLang = lang => posters.filter(p => p.lang === lang);
    const clean = list => list.filter(isClean);

    // 1) clean + idioma preferido
    let pool = clean(byLang(preferredLang));
    if (pool.length) return pick(pool);

    // 2) clean + inglês
    pool = clean(byLang("en"));
    if (pool.length) return pick(pool);

    // 3) qualquer clean
    pool = clean(posters);
    if (pool.length) return pick(pool);

    // 4) qualquer + idioma preferido
    pool = byLang(preferredLang);
    if (pool.length) return pick(pool);

    // 5) qualquer + inglês
    pool = byLang("en");
    if (pool.length) return pick(pool);

    // 6) qualquer um
    return pick(posters);
  }

  // ==========================
  // POSTERS – FILME (CLEAN + ALEATÓRIO)
  // ==========================

  async getMoviePoster(tmdbId, preferredLang = "pt") {
    try {
      const response = await fetch(
        `${this.baseURL}/movies/${tmdbId}?api_key=${this.apiKey}`,
        { timeout: 5000 }
      );

      if (!response.ok) {
        if (response.status === 404) {
          console.log(`ℹ️ Poster não encontrado para filme TMDB ID: ${tmdbId}`);
        }
        return null;
      }

      const data = await response.json();

      const posters = [];
      if (data.movieposter) {
        posters.push.apply(posters, data.movieposter);
      }
      if (data.hdmovieclearart) {
        posters.push.apply(posters, data.hdmovieclearart);
      }
      if (data.keyart) {
        posters.push.apply(posters, data.keyart);
      }

      if (posters.length === 0) return null;

      const chosen = FanartService.pickBestPoster(posters, preferredLang);
      if (chosen) {
        console.log(
          `✅ Poster Fanart (preferindo CLEAN) escolhido para filme ${tmdbId}: ${chosen.url}`
        );
        return chosen.url;
      }

      return null;
    } catch (error) {
      console.error(
        `❌ Erro ao buscar poster no Fanart.tv (filme ${tmdbId}):`,
        error.message
      );
      return null;
    }
  }

  // ==========================
  // POSTERS – SÉRIE (CLEAN + ALEATÓRIO)
  // ==========================

  async getTVPoster(tvdbId, preferredLang = "pt") {
    try {
      const response = await fetch(
        `${this.baseURL}/tv/${tvdbId}?api_key=${this.apiKey}`,
        { timeout: 5000 }
      );

      if (!response.ok) {
        if (response.status === 404) {
          console.log(`ℹ️ Poster não encontrado para série TVDB ID: ${tvdbId}`);
        }
        return null;
      }

      const data = await response.json();

      const posters = [];
      if (data.tvposter) {
        posters.push.apply(posters, data.tvposter);
      }
      if (data.seasonposter) {
        posters.push.apply(posters, data.seasonposter);
      }
      if (data.characterart) {
        posters.push.apply(posters, data.characterart);
      }

      if (posters.length === 0) return null;

      const chosen = FanartService.pickBestPoster(posters, preferredLang);
      if (chosen) {
        console.log(
          `✅ Poster Fanart (preferindo CLEAN) escolhido para série ${tvdbId}: ${chosen.url}`
        );
        return chosen.url;
      }

      return null;
    } catch (error) {
      console.error(
        `❌ Erro ao buscar poster de série (TVDB ${tvdbId}):`,
        error.message
      );
      return null;
    }
  }

  // ==========================
  // TMDB → TVDB (para séries)
  // ==========================

  async getTVDBIdFromTMDB(tmdbId, tmdbApiKey) {
    try {
      const response = await fetch(
        `https://api.themoviedb.org/3/tv/${tmdbId}/external_ids?api_key=${tmdbApiKey}`
      );

      if (!response.ok) return null;

      const data = await response.json();
      return data.tvdb_id || null;
    } catch (error) {
      console.error(
        `❌ Erro ao converter TMDB -> TVDB (${tmdbId}):`,
        error.message
      );
      return null;
    }
  }
}

export default FanartService;