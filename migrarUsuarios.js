import dotenv from "dotenv";
dotenv.config();

import admin from "firebase-admin";
import { readFileSync } from "fs";

// 🔥 Carregar chave privada
console.log("📄 Lendo orion-lab-a9298-firebase-adminsdk-fbsvc-2111a1d5f0.json...");
const serviceAccount = JSON.parse(
  readFileSync("./orion-lab-a9298-firebase-adminsdk-fbsvc-2111a1d5f0.json", "utf8")
);
console.log("✔️ Chave carregada!");

// 🔥 Inicializar Firebase Admin
console.log("🚀 Inicializando Firebase Admin...");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://orion-lab-a9298-default-rtdb.firebaseio.com"
});
console.log("✔️ Firebase Admin iniciado!");

const rtdb = admin.database();
const firestore = admin.firestore();

async function migrar() {
  try {
    console.log("⏳ Lendo usuários no Realtime Database...");

    const ref = rtdb.ref("usuarios");
    console.log("📌 Caminho RTDB:", ref.toString());

    const snap = await ref.once("value");
    console.log("📥 Snapshot recebido!");

    if (!snap.exists()) {
      console.log("⚠️ Nenhum usuário encontrado no Realtime Database.");
      return;
    }

    const usuarios = snap.val();
    const uids = Object.keys(usuarios);

    console.log(`🔍 Encontrados ${uids.length} usuários. Migrando...`);

    for (const uid of uids) {
      const dados = usuarios[uid];

      console.log(`➡️ Migrando ${uid}...`);

      await firestore.collection("usuarios").doc(uid).set(dados, { merge: true });

      console.log(`✔️ Usuário migrado: ${uid}`);
    }

    console.log("🎉 Migração concluída com sucesso!");
  } catch (err) {
    console.error("❌ Erro na migração:", err);
  }
}

migrar();
