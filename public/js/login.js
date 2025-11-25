// public/js/login.js
// Gerencia registro, login, sessão e verificação de plano (2 dias de teste)

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
  getFirestore,
  doc,
  setDoc,
  getDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
  getDatabase,
  ref,
  set
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

/* ======= CONFIG FIREBASE ======= */
const firebaseConfig = {
  apiKey: "AIzaSyCJU2wA6lL4aglQIzPrlyYdl_5xaIZqIec",
  authDomain: "orion-lab-a9298.firebaseapp.com",
  projectId: "orion-lab-a9298",
  storageBucket: "orion-lab-a9298.appspot.com",
  messagingSenderId: "421847499235",
  appId: "1:421847499235:web:5c271435a1c9d2fe58a0d6",
  databaseURL: "https://orion-lab-a9298-default-rtdb.firebaseio.com"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const rtdb = getDatabase(app);

/* =====================================================
    UTIL — TOAST
===================================================== */
function toast(msg) {
  alert(msg);
}

/* =====================================================
    UTIL — FUNÇÕES
===================================================== */
function formatISO(d = new Date()) {
  return d.toISOString();
}

function sanitizeWhatsapp(w) {
  return w.replace(/[^0-9]/g, "");
}

/* =====================================================
    SESSÃO — 30 MIN SEM ATIVIDADE
===================================================== */
function atualizarSessao() {
  localStorage.setItem("orion_last_activity", Date.now());
}

function sessaoExpirada() {
  const last = Number(localStorage.getItem("orion_last_activity"));
  if (!last) return true;
  const diff = (Date.now() - last) / 1000 / 60;
  return diff > 30;
}

window.addEventListener("mousemove", atualizarSessao);
window.addEventListener("keydown", atualizarSessao);

/* =====================================================
    VERIFICAÇÃO CENTRAL DE PLANO
===================================================== */
async function verificarPlano(uid) {
  const snap = await getDoc(doc(db, "usuarios", uid));
  if (!snap.exists()) return "sem-plano";

  const data = snap.data();
  const agora = new Date();
  const venc = data.data_expiracao ? new Date(data.data_expiracao) : null;

  if (!data.data_inicio) return "sem-plano";
  if (!venc || agora > venc || data.status !== "ativo") return "expirado";

  return "ativo";
}

/* =====================================================
    REGISTRO
===================================================== */
const registerBtn = document.getElementById("register-btn");
if (registerBtn) {
  registerBtn.addEventListener("click", async () => {
    const username = document.getElementById("register-username")?.value.trim();
    const email = document.getElementById("register-email")?.value.trim();
    const password = document.getElementById("register-password")?.value.trim();
    const confirmPassword = document.getElementById("confirm-password")?.value.trim();
    let whatsapp = document.getElementById("register-whatsapp")?.value.trim();

    if (!username || !email || !password || !confirmPassword) {
      return toast("Preencha todos os campos!");
    }
    if (password !== confirmPassword) return toast("As senhas não coincidem!");
    if (password.length < 6) return toast("A senha deve ter pelo menos 6 caracteres!");
    if (!email.includes("@") || !email.includes(".")) return toast("Digite um e-mail válido!");

    whatsapp = sanitizeWhatsapp(whatsapp || "");

    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      const user = cred.user;

      await updateProfile(user, { displayName: username });

      const agora = new Date();
      const expira = new Date();
      expira.setDate(expira.getDate() + 2);

      const userData = {
        uid: user.uid,
        nome: username,
        email,
        whatsapp,
        plano: "Teste Gratuito",
        status: "ativo",
        data_inicio: formatISO(agora),
        data_expiracao: formatISO(expira),
        ultima_atividade: formatISO(),
        logo: "",            // AGORA CORRIGIDO
        logoChanges: 0
      };

      // Firestore
      await setDoc(doc(db, "usuarios", user.uid), userData);

      // Realtime Database
      await set(ref(rtdb, "usuarios/" + user.uid), userData);

      toast("Conta criada! Seu teste gratuito de 2 dias começou.");
      atualizarSessao();
      window.location.href = "/home.html";

    } catch (err) {
      if (err.code === "auth/email-already-in-use")
        return toast("Esse e-mail já está cadastrado.");

      console.error(err);
      toast("Erro ao cadastrar: " + err.message);
    }
  });
}

/* =====================================================
    LOGIN
===================================================== */
const loginBtn = document.getElementById("login-btn");
if (loginBtn) {
  loginBtn.addEventListener("click", async () => {
    const email = document.getElementById("login-email")?.value.trim();
    const password = document.getElementById("login-password")?.value.trim();

    if (!email || !password) return toast("Preencha e-mail e senha.");

    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const status = await verificarPlano(cred.user.uid);

      if (status !== "ativo") {
        await updateDoc(doc(db, "usuarios", cred.user.uid), {
          status: "bloqueado",
          plano: "Expirado"
        });

        await signOut(auth);
        return window.location.href = "/plano-expirado.html";
      }

      await updateDoc(doc(db, "usuarios", cred.user.uid), {
        ultima_atividade: formatISO()
      });

      atualizarSessao();
      window.location.href = "/home.html";

    } catch (err) {
      console.error(err);
      toast("Erro ao logar: " + err.message);
    }
  });
}

/* =====================================================
    RESET DE SENHA
===================================================== */
const resetBtn = document.getElementById("reset-btn");
if (resetBtn) {
  resetBtn.addEventListener("click", async () => {
    const email = document.getElementById("login-email")?.value.trim();
    if (!email) return toast("Digite seu e-mail!");

    try {
      await sendPasswordResetEmail(auth, email);
      toast("Link de recuperação enviado!");
    } catch (err) {
      toast("Erro ao enviar: " + err.message);
    }
  });
}

/* =====================================================
    AUTOLOGIN + VERIFICAÇÃO
===================================================== */
onAuthStateChanged(auth, async (user) => {
  const path = window.location.pathname;

  if (!user) {
    if (!path.includes("register") && !path.includes("index"))
      return window.location.href = "/index.html";
    return;
  }

  if (sessaoExpirada()) {
    await signOut(auth);
    localStorage.removeItem("orion_last_activity");
    return window.location.href = "/index.html";
  }

  const status = await verificarPlano(user.uid);

  if (status !== "ativo") {
    await updateDoc(doc(db, "usuarios", user.uid), {
      status: "bloqueado",
      plano: "Expirado"
    });

    await signOut(auth);
    return window.location.href = "/plano-expirado.html";
  }

  await updateDoc(doc(db, "usuarios", user.uid), {
    ultima_atividade: formatISO()
  });

  atualizarSessao();

  if (
    path.endsWith("index.html") ||
    path.endsWith("register.html") ||
    path === "/"
  ) {
    window.location.href = "/home.html";
  }
});
