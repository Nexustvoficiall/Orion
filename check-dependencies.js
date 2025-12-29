// Teste Simples - Verificar Dependencias Locais
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

console.log('\n==========================================================');
console.log('   VERIFICACAO DE DEPENDENCIAS - ORION CREATOR');
console.log('==========================================================\n');

// Verificar FFmpeg
console.log('[1/4] Verificando FFmpeg...');
const ffmpegCheck = spawn('ffmpeg', ['-version']);
let ffmpegOk = false;

ffmpegCheck.stdout.on('data', (data) => {
  const version = data.toString().split('\n')[0];
  console.log('  ✅ FFmpeg instalado:', version);
  ffmpegOk = true;
});

ffmpegCheck.on('error', () => {
  console.log('  ❌ FFmpeg NAO encontrado');
  console.log('     Baixe em: https://ffmpeg.org/download.html\n');
});

// Verificar yt-dlp
setTimeout(() => {
  console.log('\n[2/4] Verificando yt-dlp...');
  
  // Tentar local primeiro
  if (fs.existsSync('yt-dlp.exe')) {
    console.log('  ✅ yt-dlp.exe encontrado na pasta do projeto');
    
    const ytdlpCheck = spawn('./yt-dlp.exe', ['--version']);
    ytdlpCheck.stdout.on('data', (data) => {
      console.log('     Versao:', data.toString().trim());
    });
  } else {
    // Tentar global
    const ytdlpCheck = spawn('yt-dlp', ['--version']);
    
    ytdlpCheck.stdout.on('data', (data) => {
      console.log('  ✅ yt-dlp instalado (global)');
      console.log('     Versao:', data.toString().trim());
    });
    
    ytdlpCheck.on('error', () => {
      console.log('  ❌ yt-dlp NAO encontrado');
      console.log('     Execute: .\start-and-test.ps1 (vai baixar automaticamente)\n');
    });
  }
}, 500);

// Verificar Overlay
setTimeout(() => {
  console.log('\n[3/4] Verificando Overlay PNG...');
  const overlayPath = path.join(process.cwd(), 'public', 'images', 'videos', 'overlay.png');
  
  if (fs.existsSync(overlayPath)) {
    const stats = fs.statSync(overlayPath);
    console.log('  ✅ Overlay encontrado');
    console.log('     Caminho:', overlayPath);
    console.log('     Tamanho:', (stats.size / 1024).toFixed(2), 'KB');
  } else {
    console.log('  ❌ Overlay NAO encontrado');
    console.log('     Esperado em:', overlayPath);
  }
}, 1000);

// Verificar Diretorios
setTimeout(() => {
  console.log('\n[4/4] Verificando Diretorios...');
  
  const tempDir = path.join(process.cwd(), 'temp');
  const outputDir = path.join(process.cwd(), 'public', 'videos');
  
  // Criar se nao existir
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  console.log('  ✅ Diretorio temp:', tempDir);
  console.log('  ✅ Diretorio output:', outputDir);
  
  // Resumo final
  setTimeout(() => {
    console.log('\n==========================================================');
    console.log('   RESUMO');
    console.log('==========================================================');
    console.log('\nPara iniciar o servidor:');
    console.log('  npm start');
    console.log('\nPara testar geracao de video:');
    console.log('  Acesse: http://localhost:3000/videos.html');
    console.log('  Faca login e busque um filme');
    console.log('\n==========================================================\n');
  }, 500);
}, 1500);
