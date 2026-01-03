/**
 * 🎨 ORION CREATOR - SERVIÇO DE LOGO DO CLIENTE
 * ============================================
 * 
 * Serviço centralizado para gerenciamento de logos de clientes.
 * Utiliza Cloudinary para armazenamento e Firestore para persistência.
 * 
 * FLUXO:
 * 1. Upload do arquivo → Cloudinary (via backend)
 * 2. URL retornada → Firestore (vinculada ao UID)
 * 3. Consumo em banners/vídeos → busca URL do Firestore
 * 4. Fallback automático para logo padrão se necessário
 */

// Configurações
const LOGO_CONFIG = {
  DEFAULT_LOGO: '/images/logo-default.png',
  MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB
  ALLOWED_TYPES: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  MAX_UPLOADS_PER_MONTH: 2,
  UPLOAD_ENDPOINT: '/api/upload-logo'
};

/**
 * Classe de serviço para gerenciamento de logos
 */
class LogoService {
  constructor(auth, db) {
    this.auth = auth;
    this.db = db;
    this.cachedLogoUrl = null;
    this.cacheTimestamp = null;
    this.CACHE_TTL = 5 * 60 * 1000; // 5 minutos
  }

  /**
   * Obtém a URL da logo do usuário atual
   * @param {string} uid - UID do usuário (opcional, usa currentUser se não fornecido)
   * @returns {Promise<string>} URL da logo ou logo padrão
   */
  async getUserLogo(uid = null) {
    try {
      const userId = uid || this.auth?.currentUser?.uid;
      
      if (!userId) {
        console.warn('⚠️ LogoService: Usuário não autenticado, usando logo padrão');
        return LOGO_CONFIG.DEFAULT_LOGO;
      }

      // Verificar cache
      if (this.cachedLogoUrl && this.cacheTimestamp) {
        const now = Date.now();
        if (now - this.cacheTimestamp < this.CACHE_TTL) {
          return this.cachedLogoUrl;
        }
      }

      // Buscar do Firebase Realtime Database
      const { ref, get, child } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js');
      const dbRef = ref(this.db);
      const snapshot = await get(child(dbRef, `usuarios/${userId}`));

      if (snapshot.exists()) {
        const dados = snapshot.val();
        // Priorizar logo_url (Cloudinary), fallback para logo (base64 legado)
        const logoUrl = dados.logo_url || dados.logo;

        if (logoUrl && this.isValidUrl(logoUrl)) {
          this.cachedLogoUrl = logoUrl;
          this.cacheTimestamp = Date.now();
          return logoUrl;
        }
      }

      console.log('ℹ️ LogoService: Usuário sem logo personalizada, usando padrão');
      return LOGO_CONFIG.DEFAULT_LOGO;

    } catch (error) {
      console.error('❌ LogoService.getUserLogo erro:', error);
      return LOGO_CONFIG.DEFAULT_LOGO;
    }
  }

  /**
   * Verifica se a string é uma URL válida (não base64)
   * @param {string} str - String para validar
   * @returns {boolean}
   */
  isValidUrl(str) {
    if (!str || typeof str !== 'string') return false;
    // Rejeitar base64
    if (str.startsWith('data:')) return false;
    // Aceitar URLs http/https
    try {
      const url = new URL(str);
      return ['http:', 'https:'].includes(url.protocol);
    } catch {
      return false;
    }
  }

  /**
   * Valida um arquivo antes do upload
   * @param {File} file - Arquivo para validar
   * @returns {{valid: boolean, error?: string}}
   */
  validateFile(file) {
    if (!file) {
      return { valid: false, error: 'Nenhum arquivo selecionado' };
    }

    if (!LOGO_CONFIG.ALLOWED_TYPES.includes(file.type)) {
      return { 
        valid: false, 
        error: 'Formato inválido. Use: PNG, JPG, WebP ou GIF' 
      };
    }

    if (file.size > LOGO_CONFIG.MAX_FILE_SIZE) {
      return { 
        valid: false, 
        error: `Arquivo muito grande. Máximo: ${LOGO_CONFIG.MAX_FILE_SIZE / 1024 / 1024}MB` 
      };
    }

    return { valid: true };
  }

  /**
   * Verifica uploads restantes do usuário
   * @param {string} uid - UID do usuário
   * @returns {Promise<{restantes: number, dataReset: Date|null}>}
   */
  async getUploadsRestantes(uid) {
    try {
      const { ref, get, child } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js');
      const dbRef = ref(this.db);
      const snapshot = await get(child(dbRef, `usuarios/${uid}`));

      if (snapshot.exists()) {
        const dados = snapshot.val();
        const restantes = dados.uploads_restantes ?? LOGO_CONFIG.MAX_UPLOADS_PER_MONTH;
        const dataReset = dados.data_reset_logo ? new Date(dados.data_reset_logo) : null;
        
        return { restantes, dataReset };
      }

      return { restantes: LOGO_CONFIG.MAX_UPLOADS_PER_MONTH, dataReset: null };

    } catch (error) {
      console.error('❌ LogoService.getUploadsRestantes erro:', error);
      return { restantes: 0, dataReset: null };
    }
  }

  /**
   * Faz upload da logo para o Cloudinary via backend
   * @param {File} file - Arquivo de imagem
   * @param {string} authToken - Token de autenticação Firebase
   * @returns {Promise<{success: boolean, logoUrl?: string, error?: string}>}
   */
  async uploadLogo(file, authToken) {
    try {
      // Validar arquivo
      const validation = this.validateFile(file);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      // Verificar autenticação
      if (!authToken) {
        return { success: false, error: 'Token de autenticação não fornecido' };
      }

      // Criar FormData
      const formData = new FormData();
      formData.append('logo', file);

      // Fazer upload para o backend
      const response = await fetch(LOGO_CONFIG.UPLOAD_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        body: formData
      });

      const result = await response.json();

      if (!response.ok) {
        return { 
          success: false, 
          error: result.error || `Erro no upload: ${response.status}` 
        };
      }

      // Limpar cache
      this.cachedLogoUrl = null;
      this.cacheTimestamp = null;

      return { 
        success: true, 
        logoUrl: result.logoUrl,
        uploadsRestantes: result.uploadsRestantes
      };

    } catch (error) {
      console.error('❌ LogoService.uploadLogo erro:', error);
      return { success: false, error: 'Erro de conexão. Tente novamente.' };
    }
  }

  /**
   * Atualiza a UI com as informações da logo
   * @param {Object} elements - Elementos DOM
   * @param {string} uid - UID do usuário
   */
  async updateUI(elements, uid) {
    try {
      const { logoPreviewImg, logoPlaceholder, uploadsRestantes, dataReset, btnUpload } = elements;
      
      // Buscar dados
      const [logoUrl, uploadInfo] = await Promise.all([
        this.getUserLogo(uid),
        this.getUploadsRestantes(uid)
      ]);

      // Atualizar preview da logo
      if (logoPreviewImg) {
        if (logoUrl && logoUrl !== LOGO_CONFIG.DEFAULT_LOGO) {
          logoPreviewImg.src = logoUrl;
          logoPreviewImg.style.display = 'block';
          if (logoPlaceholder) logoPlaceholder.style.display = 'none';
        } else {
          logoPreviewImg.style.display = 'none';
          if (logoPlaceholder) {
            logoPlaceholder.style.display = 'block';
            logoPlaceholder.textContent = 'Nenhuma logo';
          }
        }
      }

      // Atualizar contador de uploads
      if (uploadsRestantes) {
        uploadsRestantes.textContent = uploadInfo.restantes;
      }

      // Atualizar data de reset
      if (dataReset && uploadInfo.dataReset) {
        dataReset.textContent = uploadInfo.dataReset.toLocaleDateString('pt-BR');
      }

      // Atualizar estado do botão
      if (btnUpload) {
        if (uploadInfo.restantes <= 0) {
          btnUpload.disabled = true;
          btnUpload.textContent = 'Limite Atingido';
        } else {
          btnUpload.disabled = false;
          btnUpload.textContent = 'Enviar Logo';
        }
      }

    } catch (error) {
      console.error('❌ LogoService.updateUI erro:', error);
    }
  }

  /**
   * Limpa o cache forçadamente
   */
  clearCache() {
    this.cachedLogoUrl = null;
    this.cacheTimestamp = null;
  }
}

// Exportar configurações e classe
export { LOGO_CONFIG, LogoService };
export default LogoService;
