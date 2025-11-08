// ===== IMPORTA OS MÓDULOS DO FIREBASE =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase, ref, get, update } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ===== CONFIGURAÇÃO DO FIREBASE =====
const firebaseConfig = {
  apiKey: "AIzaSyCJU2wA6lL4aglQIzPrlyYdl_5xaIZqIec",
  authDomain: "orion-lab-a9298.firebaseapp.com",
  projectId: "orion-lab-a9298",
  storageBucket: "orion-lab-a9298.appspot.com",
  messagingSenderId: "421847499235",
  appId: "1:421847499235:web:5c271435a1c9d2fe58a0d6",
  databaseURL: "https://orion-lab-a9298-default-rtdb.firebaseio.com"
};

// ===== INICIALIZA FIREBASE =====
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// ===== FUNÇÃO AUXILIAR =====
function diasRestantes(dataExpiracao) {
  const hoje = new Date();
  const expira = new Date(dataExpiracao);
  const diff = Math.ceil((expira - hoje) / (1000 * 60 * 60 * 24));
  return diff;
}

// ===== VERIFICA LOGIN =====
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  const uid = user.uid;
  const userRef = ref(db, "usuarios/" + uid);
  const snapshot = await get(userRef);

  if (snapshot.exists()) {
    const userData = snapshot.val();
    const dias = diasRestantes(userData.data_expiracao);

    const planoStatus = document.getElementById("plano-status");
    const planosDiv = document.getElementById("planos-container");
    planosDiv.style.display = "none";

    // ===== ESTILO DO CARD =====
    planoStatus.style.background = "linear-gradient(135deg, #1e1e2f, #2c2c54)";
    planoStatus.style.color = "#fff";
    planoStatus.style.borderRadius = "20px";
    planoStatus.style.padding = "25px";
    planoStatus.style.boxShadow = "0 5px 15px rgba(0,0,0,0.3)";
    planoStatus.style.textAlign = "center";
    planoStatus.style.fontFamily = "'Poppins', sans-serif";
    planoStatus.style.margin = "20px auto";
    planoStatus.style.width = "90%";
    planoStatus.style.maxWidth = "480px";

    // ===== SITUAÇÃO DO PLANO =====
    if (dias > 5) {
      planoStatus.innerHTML = `
        <h3 style="color:#8ab4f8;">🪐 Bem-vindo, ${userData.nome}!</h3>
        <p>Seu plano: <strong>${userData.plano}</strong></p>
        <p>Válido por mais <strong>${dias}</strong> dia(s).</p>
      `;
    } 
    else if (dias > 0 && dias <= 5) {
      planoStatus.innerHTML = `
        <h3 style="color:#FFD166;">⚠️ Seu plano está prestes a vencer!</h3>
        <p>Faltam apenas <strong>${dias}</strong> dia(s).</p>
        <p>Plano atual: <strong>${userData.plano}</strong></p>
        <button id="renovarBtn" style="
          margin-top: 15px;
          background: linear-gradient(135deg, #4facfe, #00f2fe);
          border: none;
          border-radius: 50px;
          color: #fff;
          padding: 12px 25px;
          font-size: 16px;
          cursor: pointer;
          box-shadow: 0 4px 10px rgba(0,0,0,0.4);
          transition: all 0.3s ease;
        ">🔁 Renovar Plano</button>
      `;

      // ===== BOTÃO RENOVAR =====
      const renovarBtn = document.getElementById("renovarBtn");
      renovarBtn.addEventListener("click", async () => {
        const novaData = new Date();
        novaData.setDate(novaData.getDate() + 30); // renova +30 dias

        await update(userRef, {
          data_expiracao: novaData.toISOString()
        });

        alert("✅ Plano renovado por mais 30 dias!");
        window.location.reload();
      });
    } 
    else {
      planoStatus.innerHTML = `
        <h3 style="color:#FF6B6B;">❌ Seu plano expirou!</h3>
        <p>Escolha um novo plano para continuar criando seus banners:</p>
      `;
      planosDiv.style.display = "flex";
    }
  }
});

// ===== BOTÕES DE PLANOS =====
const btnPlano15 = document.getElementById("plano15");
const btnPlano30 = document.getElementById("plano30");

if (btnPlano15) {
  btnPlano15.addEventListener("click", () => comprarPlano(15, 14.00));
}
if (btnPlano30) {
  btnPlano30.addEventListener("click", () => comprarPlano(30, 20.00));
}

// ===== FUNÇÃO DE COMPRA (SIMULAÇÃO) =====
async function comprarPlano(dias, valor) {
  const user = auth.currentUser;
  if (!user) return alert("Você precisa estar logado.");

  const confirmacao = confirm(`Deseja adquirir o plano de ${dias} dias por R$${valor.toFixed(2)}?`);
  if (!confirmacao) return;

  const userRef = ref(db, "usuarios/" + user.uid);
  const novaData = new Date();
  novaData.setDate(novaData.getDate() + dias);

  await update(userRef, {
    plano: `${dias} dias`,
    data_expiracao: novaData.toISOString()
  });

  alert(`Plano de ${dias} dias ativado com sucesso! 🚀`);
  window.location.reload();
}

// ===== SAIR =====
const sairBtn = document.getElementById("logout-btn");
if (sairBtn) {
  sairBtn.addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "index.html";
  });
}
