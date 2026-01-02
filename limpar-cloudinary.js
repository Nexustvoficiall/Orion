import cloudinary from './api/cloudinary.js';

console.log('🗑️  Sistema de Limpeza Automática do Cloudinary');
console.log('🔄 Roda a cada 24 horas');
console.log('📂 Apaga apenas: banners/ (NÃO apaga logos de usuários)\n');

async function limparBannersGerados() {
  try {
    const agora = new Date().toLocaleString('pt-BR');
    console.log(`⏰ [${agora}] Iniciando limpeza de banners...`);
    
    // Apagar apenas a pasta "banners/" onde ficam os banners gerados
    // NÃO apaga logos de usuários que ficam em outras pastas
    const result = await cloudinary.api.delete_resources_by_prefix('banners/', {
      resource_type: 'image',
      invalidate: true
    });
    
    const deletados = result.deleted ? Object.keys(result.deleted).length : 0;
    
    if (deletados > 0) {
      console.log(`✅ ${deletados} banner(s) apagado(s) com sucesso!`);
    } else {
      console.log('ℹ️  Nenhum banner encontrado para apagar.');
    }
    
    console.log(`📊 Próxima limpeza em 24 horas.\n`);
    
  } catch (error) {
    console.error('❌ Erro ao limpar banners:', error.message);
    if (error.error && error.error.message) {
      console.error('   Detalhes:', error.error.message);
    }
  }
}

// Executar imediatamente ao iniciar
limparBannersGerados();

// Agendar para rodar a cada 24 horas (86400000 ms)
setInterval(limparBannersGerados, 24 * 60 * 60 * 1000);

console.log('🚀 Sistema de limpeza automática ativo!');
