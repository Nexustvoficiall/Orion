// 🧪 Script de Teste - Geração de Vídeo Vertical
// Executar: node test-video-generation.js

import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

const API_URL = 'http://localhost:3000';
const FIREBASE_TOKEN = process.env.FIREBASE_TEST_TOKEN || 'SEU_TOKEN_AQUI';

// Casos de teste
const testCases = [
  {
    name: 'Filme Popular - Avatar',
    payload: {
      tmdbId: 19995,
      tmdbTipo: 'movie',
      duracao: 30
    }
  },
  {
    name: 'Série - Breaking Bad T1',
    payload: {
      tmdbId: 1396,
      tmdbTipo: 'tv',
      duracao: 30,
      temporada: 1
    }
  },
  {
    name: 'Filme Recente - Megan',
    payload: {
      tmdbId: 872585,
      tmdbTipo: 'movie',
      duracao: 60
    }
  }
];

async function testVideoGeneration(testCase) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🧪 TESTANDO: ${testCase.name}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`📦 Payload:`, JSON.stringify(testCase.payload, null, 2));
  
  const startTime = Date.now();
  
  try {
    console.log(`\n🌐 Enviando requisição para ${API_URL}/api/gerar-video...`);
    
    const response = await fetch(`${API_URL}/api/gerar-video`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${FIREBASE_TOKEN}`
      },
      body: JSON.stringify(testCase.payload)
    });
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log(`\n📊 Status: ${response.status} ${response.statusText}`);
    console.log(`⏱️ Tempo de resposta: ${duration}s`);
    
    if (!response.ok) {
      const error = await response.json();
      console.error(`\n❌ ERRO:`, error);
      return { success: false, error, duration };
    }
    
    // Salvar vídeo
    const buffer = await response.buffer();
    const filename = `test_video_${testCase.payload.tmdbId}_${Date.now()}.mp4`;
    const filepath = path.join(process.cwd(), 'test-outputs', filename);
    
    // Criar diretório se não existir
    if (!fs.existsSync(path.join(process.cwd(), 'test-outputs'))) {
      fs.mkdirSync(path.join(process.cwd(), 'test-outputs'), { recursive: true });
    }
    
    fs.writeFileSync(filepath, buffer);
    
    const fileSize = (buffer.length / (1024 * 1024)).toFixed(2);
    
    console.log(`\n✅ SUCESSO!`);
    console.log(`📁 Arquivo salvo: ${filename}`);
    console.log(`📏 Tamanho: ${fileSize} MB`);
    
    // Verificar com ffprobe se disponível
    try {
      const { exec } = await import('child_process');
      const util = await import('util');
      const execPromise = util.promisify(exec);
      
      const { stdout } = await execPromise(`ffprobe -v error -select_streams v:0 -show_entries stream=width,height,codec_name,r_frame_rate -of csv=p=0 "${filepath}"`);
      console.log(`🎬 Informações do vídeo: ${stdout.trim()}`);
    } catch (err) {
      console.log(`⚠️ ffprobe não disponível para validação`);
    }
    
    return { success: true, filename, fileSize, duration };
    
  } catch (err) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error(`\n❌ ERRO NA REQUISIÇÃO:`, err.message);
    return { success: false, error: err.message, duration };
  }
}

async function testHealth() {
  console.log(`\n🏥 Verificando saúde do servidor...`);
  
  try {
    const response = await fetch(`${API_URL}/api/health`);
    const data = await response.json();
    
    console.log(`✅ Servidor: ${data.server ? 'OK' : 'ERRO'}`);
    console.log(`✅ Firebase: ${data.firebase ? 'OK' : 'ERRO'}`);
    console.log(`✅ TMDB: ${data.tmdb ? 'OK' : 'ERRO'}`);
    console.log(`✅ Fanart: ${data.fanart ? 'OK' : 'ERRO'}`);
    console.log(`⏱️ Uptime: ${(data.uptime / 60).toFixed(2)} minutos`);
    
    return data.firebase && data.tmdb;
  } catch (err) {
    console.error(`❌ Falha no health check:`, err.message);
    return false;
  }
}

async function testDiagnostics() {
  console.log(`\n🔧 Verificando diagnósticos de vídeo...`);
  
  try {
    const response = await fetch(`${API_URL}/api/test-video`, {
      headers: {
        'Authorization': `Bearer ${FIREBASE_TOKEN}`
      }
    });
    
    const data = await response.json();
    
    console.log(`\n📊 Ferramentas instaladas:`);
    console.log(`  FFmpeg: ${data.tools?.ffmpeg?.installed ? '✅ Instalado' : '❌ Não encontrado'}`);
    if (data.tools?.ffmpeg?.version) {
      console.log(`    Versão: ${data.tools.ffmpeg.version}`);
    }
    
    console.log(`  yt-dlp: ${data.tools?.ytdlp?.installed ? '✅ Instalado' : '❌ Não encontrado'}`);
    if (data.tools?.ytdlp?.version) {
      console.log(`    Versão: ${data.tools.ytdlp.version}`);
    }
    
    console.log(`\n📂 Verificações de arquivos:`);
    console.log(`  Overlay PNG: ${data.checks?.overlay ? '✅ Encontrado' : '❌ Não encontrado'}`);
    console.log(`  Diretório temp: ${data.checks?.tempDir ? '✅ OK' : '❌ Erro'}`);
    console.log(`  Diretório output: ${data.checks?.outputDir ? '✅ OK' : '❌ Erro'}`);
    
    console.log(`\n📍 Caminhos:`);
    console.log(`  Temp: ${data.paths?.temp}`);
    console.log(`  Output: ${data.paths?.output}`);
    console.log(`  Overlay: ${data.paths?.overlay}`);
    
    console.log(`\n${data.ready ? '✅ Sistema PRONTO para gerar vídeos!' : '❌ Sistema NÃO está pronto'}`);
    
    if (data.issues && data.issues.length > 0) {
      console.log(`\n⚠️ Problemas encontrados:`);
      data.issues.forEach((issue, i) => {
        console.log(`  ${i + 1}. ${issue}`);
      });
    }
    
    return data.ready;
  } catch (err) {
    console.error(`❌ Falha no diagnóstico:`, err.message);
    return false;
  }
}

async function runTests() {
  console.log(`
╔═══════════════════════════════════════════════════════╗
║  🎬 TESTE DE GERAÇÃO DE VÍDEO VERTICAL (1080x1920)   ║
║  Orion Creator - Video Generation System             ║
╚═══════════════════════════════════════════════════════╝
  `);
  
  // 1. Verificar saúde do servidor
  const isHealthy = await testHealth();
  if (!isHealthy) {
    console.error(`\n❌ Servidor não está saudável. Abortando testes.`);
    process.exit(1);
  }
  
  // 2. Verificar diagnósticos
  const isReady = await testDiagnostics();
  if (!isReady) {
    console.error(`\n❌ Sistema não está pronto. Verifique as dependências acima.`);
    process.exit(1);
  }
  
  // 3. Executar testes de geração
  console.log(`\n\n${'='.repeat(60)}`);
  console.log(`🚀 INICIANDO TESTES DE GERAÇÃO DE VÍDEO`);
  console.log(`${'='.repeat(60)}`);
  
  const results = [];
  
  for (const testCase of testCases) {
    const result = await testVideoGeneration(testCase);
    results.push({ ...testCase, ...result });
    
    // Aguardar 5 segundos entre testes para não sobrecarregar
    if (testCases.indexOf(testCase) < testCases.length - 1) {
      console.log(`\n⏳ Aguardando 5 segundos antes do próximo teste...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  
  // 4. Resumo final
  console.log(`\n\n${'='.repeat(60)}`);
  console.log(`📊 RESUMO DOS TESTES`);
  console.log(`${'='.repeat(60)}`);
  
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  console.log(`\n✅ Sucessos: ${successful}/${results.length}`);
  console.log(`❌ Falhas: ${failed}/${results.length}`);
  
  results.forEach((result, i) => {
    const icon = result.success ? '✅' : '❌';
    console.log(`\n${icon} Teste ${i + 1}: ${result.name}`);
    console.log(`   Duração: ${result.duration}s`);
    if (result.success) {
      console.log(`   Arquivo: ${result.filename} (${result.fileSize} MB)`);
    } else {
      console.log(`   Erro: ${result.error?.error || result.error}`);
    }
  });
  
  if (successful === results.length) {
    console.log(`\n\n🎉 TODOS OS TESTES PASSARAM! Sistema funcionando perfeitamente.`);
  } else {
    console.log(`\n\n⚠️ Alguns testes falharam. Revise os erros acima.`);
  }
}

// Executar testes
runTests().catch(err => {
  console.error(`\n❌ ERRO FATAL:`, err);
  process.exit(1);
});
