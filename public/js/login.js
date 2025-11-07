// public/js/login.js
// Gerencia registro, login, reset e verificação de plano (2 dias de teste)
// NÃO armazena senha em texto no DB (por segurança).

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
  updateProfile,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  set,
  get,
  update
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

/* ======= CONFIG FIREBASE ======= */
const firebaseConfig = {
  apiKey: "AIzaSyCJU2wA6lL4aglQIzPrlyYdl_5xaIZqIec",
  authDomain: "orion-lab-a9298.firebaseapp.com",
  databaseURL: "https://orion-lab-a9298-default-rtdb.firebaseio.com",
  projectId: "orion-lab-a9298",
  storageBucket: "orion-lab-a9298.appspot.com",
  messagingSenderId: "421847499235",
  appId: "1:421847499235:web:5c271435a1c9d2fe58a0d6"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

/* ======= UTIL ======= */
function formatarData(d) {
  return d.toISOString().split('T')[0]; // YYYY-MM-DD
}

/* ======= REGISTRO (página register.html) ======= */
const registerBtn = document.getElementById("register-btn");
if (registerBtn) {
  registerBtn.addEventListener("click", async () => {
    const username = document.getElementById("register-username")?.value?.trim();
    const email = document.getElementById("register-email")?.value?.trim();
    const password = document.getElementById("register-password")?.value?.trim();
    const confirmPassword = document.getElementById("confirm-password")?.value?.trim();
    const whatsapp = document.getElementById("register-whatsapp")?.value?.trim(); // novo campo WhatsApp

    if (!username || !email || !password || !confirmPassword) {
      return alert("Preencha todos os campos!");
    }
    if (password !== confirmPassword) return alert("As senhas não coincidem!");

    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      const user = cred.user;

      // Atualiza displayName no Auth
      await updateProfile(user, { displayName: username });

      // datas
      const dataInicio = new Date();
      const dataExpiracao = new Date();
      dataExpiracao.setDate(dataExpiracao.getDate() + 2); // 2 dias de teste

      // dados completos pro painel e home
      const userData = {
        uid: user.uid,
        nome: username,
        email: email,
        whatsapp: whatsapp || "",
        plano: "Teste Gratuito",
        status: "ativo",
        data_inicio: formatarData(dataInicio),
        data_expiracao: formatarData(dataExpiracao)
      };

      await set(ref(db, "usuarios/" + user.uid), userData);

      alert("Conta criada! Você tem 2 dias de teste gratuito.");
      window.location.href = "/home.html";

    } catch (err) {
      if (err.code === "auth/email-already-in-use") {
        alert("Esse e-mail já está cadastrado. Faça login ou use outro e-mail.");
      } else {
        alert("Erro ao cadastrar: " + (err.message || err));
      }
      console.error("Erro ao cadastrar:", err);
    }
  });
}

/* ======= LOGIN (página index.html) ======= */
const loginBtn = document.getElementById("login-btn");
if (loginBtn) {
  loginBtn.addEventListener("click", async () => {
    const email = document.getElementById("login-email")?.value?.trim();
    const password = document.getElementById("login-password")?.value?.trim();
    if (!email || !password) return alert("Preencha os campos de e-mail e senha.");

    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const uid = cred.user.uid;

      const snap = await get(ref(db, "usuarios/" + uid));
      if (!snap.exists()) {
        await signOut(auth);
        return alert("Usuário criado no Auth, porém sem dados no banco. Contate o suporte.");
      }
      const data = snap.val();

      const hoje = new Date();
      const venc = data.data_expiracao ? new Date(data.data_expiracao) : null;

      if (venc && hoje > venc) {
        await update(ref(db, "usuarios/" + uid), { status: "bloqueado", plano: "Expirado" });
        await signOut(auth);
        return window.location.href = "/plano-expirado.html";
      }

      if (data.status === "bloqueado" || data.status === "expirado") {
        await signOut(auth);
        return window.location.href = "/plano-expirado.html";
      }

      // Tudo ok
      window.location.href = "/home.html";
    } catch (err) {
      console.error("Erro login:", err);
      alert("Erro ao logar: " + (err.message || err));
    }
  });
}

/* ======= RESET DE SENHA ======= */
const resetBtn = document.getElementById("reset-btn");
if (resetBtn) {
  resetBtn.addEventListener("click", async () => {
    const email = document.getElementById("login-email")?.value?.trim();
    if (!email) return alert("Digite seu e-mail para receber o link de redefinição.");
    try {
      await sendPasswordResetEmail(auth, email);
      alert("E-mail de redefinição enviado. Verifique sua caixa de entrada.");
    } catch (err) {
      console.error("Erro reset:", err);
      alert("Erro ao enviar redefinição: " + (err.message || err));
    }
  });
}

/* ======= AUTO-REDIRECT SE JÁ LOGADO ======= */
onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  const dbRef = ref(db, "usuarios/" + user.uid);
  const snap = await get(dbRef);

  if (!snap.exists()) {
    await signOut(auth);
    return window.location.href = "/index.html";
  }

  const data = snap.val();
  const hoje = new Date();
  const venc = data.data_expiracao ? new Date(data.data_expiracao) : null;

  if (!venc || hoje > venc || data.status === "bloqueado" || data.status === "expirado") {
    await update(dbRef, { status: "bloqueado", plano: "Expirado" });
    await signOut(auth);
    return window.location.href = "/plano-expirado.html";
  }

  const path = window.location.pathname;
  if (path.endsWith("index.html") || path.endsWith("register.html") || path === "/") {
    window.location.href = "/home.html";
  }
});
