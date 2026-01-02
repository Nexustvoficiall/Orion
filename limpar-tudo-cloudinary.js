import cloudinary from './api/cloudinary.js';

console.log('🗑️  LIMPEZA TOTAL DO CLOUDINARY');
console.log('⚠️  Apagando TODOS os arquivos (exceto logos de usuários)\n');

async function limparTudoCloudinary() {
  try {
    let totalDeletados = 0;
    let pagina = 1;
    let temMais = true;
    
    while (temMais) {
      console.log(`📄 Buscando página ${pagina}...`);
      
      // Buscar todos os recursos (até 500 por vez)
      const resultado = await cloudinary.api.resources({
        resource_type: 'image',
        type: 'upload',
        max_results: 500,
        prefix: '' // Busca tudo
      });
      
      const recursos = resultado.resources;
      
      if (recursos.length === 0) {
        temMais = false;
        break;
      }
      
      // Filtrar: NÃO apagar logos de usuários (que geralmente têm 'logo' no public_id ou estão em pasta específica)
      const paraApagar = recursos.filter(r => {
        const id = r.public_id.toLowerCase();
        // NÃO apagar se contém 'logo' ou 'usuario' ou 'user' no caminho
        return !id.includes('logo') && !id.includes('usuario') && !id.includes('user');
      });
      
      console.log(`📋 Encontrados ${recursos.length} recursos, ${paraApagar.length} serão apagados (${recursos.length - paraApagar.length} logos preservadas)`);
      
      if (paraApagar.length > 0) {
        // Apagar em lotes de 100 (limite da API)
        const lotes = [];
        for (let i = 0; i < paraApagar.length; i += 100) {
          lotes.push(paraApagar.slice(i, i + 100));
        }
        
        for (const lote of lotes) {
          const ids = lote.map(r => r.public_id);
          try {
            const resultado = await cloudinary.api.delete_resources(ids, {
              invalidate: true
            });
            const deletados = Object.keys(resultado.deleted || {}).length;
            totalDeletados += deletados;
            console.log(`   ✅ Lote apagado: ${deletados} arquivos`);
          } catch (err) {
            console.error(`   ❌ Erro ao apagar lote:`, err.message);
          }
        }
      }
      
      // Se retornou menos de 500, não tem mais páginas
      if (recursos.length < 500) {
        temMais = false;
      } else {
        pagina++;
      }
    }
    
    console.log(`\n✨ Limpeza concluída!`);
    console.log(`📊 Total de arquivos apagados: ${totalDeletados}`);
    console.log(`🔒 Logos de usuários preservadas\n`);
    
  } catch (error) {
    console.error('❌ Erro ao limpar Cloudinary:', error.message);
    if (error.error && error.error.message) {
      console.error('   Detalhes:', error.error.message);
    }
  }
}

// Confirmar antes de executar
console.log('⚠️  ATENÇÃO: Este script vai apagar TODOS os arquivos do Cloudinary');
console.log('           (exceto os que contêm "logo", "usuario" ou "user" no nome)');
console.log('\n🔄 Iniciando em 3 segundos...\n');

setTimeout(() => {
  limparTudoCloudinary();
}, 3000);
