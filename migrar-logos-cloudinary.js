/**
 * Script de Migração de Logos Base64 para Cloudinary
 * 
 * Este script:
 * 1. Busca todos os usuários no Firestore
 * 2. Identifica logos armazenadas como base64
 * 3. Faz upload para Cloudinary
 * 4. Atualiza o Firestore com a nova URL
 * 
 * Uso: node migrar-logos-cloudinary.js [--dry-run]
 *   --dry-run: Apenas simula, não faz alterações
 */

import admin from "firebase-admin";
import { v2 as cloudinary } from "cloudinary";
import dotenv from "dotenv";

dotenv.config();

// Configurar Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configurar Firebase Admin
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

if (!privateKey || !process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL) {
  console.error("❌ Variáveis de ambiente do Firebase não configuradas!");
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      privateKey: privateKey,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL
    })
  });
}

const db = admin.firestore();
const isDryRun = process.argv.includes("--dry-run");

if (isDryRun) {
  console.log("🔍 Modo DRY-RUN: Nenhuma alteração será feita\n");
}

/**
 * Verifica se uma string é base64
 */
function isBase64(str) {
  if (!str || typeof str !== 'string') return false;
  return str.startsWith('data:image/');
}

/**
 * Faz upload de base64 para Cloudinary
 */
async function uploadToCloudinary(base64String, uid) {
  try {
    const result = await cloudinary.uploader.upload(base64String, {
      folder: `orion_creator/logos`,
      public_id: `user_${uid}_${Date.now()}`,
      overwrite: true,
      resource_type: 'image',
      format: 'png',
      transformation: [
        { quality: 'auto:good' },
        { fetch_format: 'auto' }
      ]
    });
    return result.secure_url;
  } catch (error) {
    console.error(`  ❌ Erro no upload Cloudinary:`, error.message);
    return null;
  }
}

/**
 * Processa um usuário
 */
async function processUser(doc) {
  const uid = doc.id;
  const data = doc.data();
  const logoUrl = data.logo_url || data.logo;
  
  if (!logoUrl) {
    return { status: 'sem-logo', uid };
  }
  
  if (!isBase64(logoUrl)) {
    // Já é uma URL, verificar se é válida
    try {
      new URL(logoUrl);
      return { status: 'ja-url', uid, url: logoUrl.substring(0, 60) };
    } catch {
      return { status: 'url-invalida', uid };
    }
  }
  
  // É base64, precisa migrar
  const base64Size = Math.round(logoUrl.length / 1024);
  console.log(`  📦 Logo base64 encontrada: ~${base64Size}KB`);
  
  if (isDryRun) {
    return { status: 'migrar-dry-run', uid, size: base64Size };
  }
  
  // Fazer upload para Cloudinary
  const cloudinaryUrl = await uploadToCloudinary(logoUrl, uid);
  
  if (!cloudinaryUrl) {
    return { status: 'erro-upload', uid };
  }
  
  // Atualizar Firestore
  try {
    await db.collection('usuarios').doc(uid).update({
      logo_url: cloudinaryUrl,
      logo: cloudinaryUrl, // Manter compatibilidade
      logo_migrated_at: new Date().toISOString(),
      logo_migrated_from: 'base64'
    });
    
    return { status: 'migrado', uid, newUrl: cloudinaryUrl };
  } catch (error) {
    console.error(`  ❌ Erro ao atualizar Firestore:`, error.message);
    return { status: 'erro-firestore', uid };
  }
}

/**
 * Executa a migração
 */
async function main() {
  console.log("🚀 Iniciando migração de logos base64 para Cloudinary\n");
  
  const stats = {
    total: 0,
    'sem-logo': 0,
    'ja-url': 0,
    'url-invalida': 0,
    'migrado': 0,
    'migrar-dry-run': 0,
    'erro-upload': 0,
    'erro-firestore': 0
  };
  
  try {
    const usuariosRef = db.collection('usuarios');
    const snapshot = await usuariosRef.get();
    
    console.log(`📊 Total de usuários encontrados: ${snapshot.size}\n`);
    stats.total = snapshot.size;
    
    for (const doc of snapshot.docs) {
      console.log(`\n👤 Processando: ${doc.id}`);
      const result = await processUser(doc);
      stats[result.status] = (stats[result.status] || 0) + 1;
      
      switch (result.status) {
        case 'sem-logo':
          console.log(`  ⚪ Sem logo cadastrada`);
          break;
        case 'ja-url':
          console.log(`  ✅ Já é URL: ${result.url}...`);
          break;
        case 'url-invalida':
          console.log(`  ⚠️ URL inválida cadastrada`);
          break;
        case 'migrar-dry-run':
          console.log(`  🔄 [DRY-RUN] Seria migrado (~${result.size}KB)`);
          break;
        case 'migrado':
          console.log(`  ✅ Migrado: ${result.newUrl}`);
          break;
        case 'erro-upload':
          console.log(`  ❌ Falha no upload`);
          break;
        case 'erro-firestore':
          console.log(`  ❌ Falha ao salvar no Firestore`);
          break;
      }
    }
    
  } catch (error) {
    console.error("❌ Erro fatal:", error.message);
    process.exit(1);
  }
  
  // Resumo final
  console.log("\n" + "=".repeat(50));
  console.log("📊 RESUMO DA MIGRAÇÃO");
  console.log("=".repeat(50));
  console.log(`Total de usuários: ${stats.total}`);
  console.log(`Sem logo: ${stats['sem-logo']}`);
  console.log(`Já eram URLs: ${stats['ja-url']}`);
  console.log(`URLs inválidas: ${stats['url-invalida']}`);
  
  if (isDryRun) {
    console.log(`\n🔄 A migrar (dry-run): ${stats['migrar-dry-run']}`);
    console.log("\n💡 Execute sem --dry-run para aplicar as mudanças");
  } else {
    console.log(`\n✅ Migrados com sucesso: ${stats['migrado']}`);
    console.log(`❌ Erros de upload: ${stats['erro-upload']}`);
    console.log(`❌ Erros de Firestore: ${stats['erro-firestore']}`);
  }
  
  console.log("=".repeat(50));
  
  process.exit(0);
}

main();
