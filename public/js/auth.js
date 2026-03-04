// ===== IMPORTA OS MÓDULOS DO FIREBASE =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  set
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

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

// ===== FUNÇÃO PARA GERAR DATA DE VENCIMENTO =====
// EDITADO POR ORION
function gerarDataVencimento(dias) {
  const hoje = new Date();
  hoje.setDate(hoje.getDate() + dias);
  return hoje.toISOString(); // salva no formato ISO para fácil leitura
}

// ===== LOGIN =====
const loginBtn = document.getElementById("login-btn");
if (loginBtn) {
  loginBtn.addEventListener("click", async () => {
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value.trim();

    if (!email || !password) {
      alert("Por favor, preencha todos os campos!");
      return;
    }

    try {
      await signInWithEmailAndPassword(auth, email, password);
      alert("Login realizado com sucesso! 🚀");
      window.location.href = "home.html";
    } catch (error) {
      alert("Erro ao fazer login: " + traduzErro(error.code));
    }
  });
}

// ===== CADASTRO =====
const registerBtn = document.getElementById("register-btn");
if (registerBtn) {
  registerBtn.addEventListener("click", async () => {
    const username = document.getElementById("register-username")?.value.trim();
    const email = document.getElementById("register-email")?.value.trim();
    const password = document.getElementById("register-password")?.value.trim();
    const confirmPassword = document.getElementById("confirm-password")?.value.trim();

    if (!username || !email || !password || !confirmPassword) {
      alert("Preencha todos os campos!");
      return;
    }

    if (password !== confirmPassword) {
      alert("As senhas não coincidem!");
      return;
    }

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      await updateProfile(user, { displayName: username });

      // ===== ESTRUTURA COMPLETA DO USUÁRIO (EDITADO POR ORION) =====
      // ⚠️ NUNCA armazenar senhas em texto puro - Firebase Auth já gerencia isso de forma segura
      const userData = {
        uid: user.uid,
        nome: username,
        email: email,
        criado_em: new Date().toISOString(),
        plano: "Teste Gratuito",
        status: "ativo",
        vencimento: gerarDataVencimento(2), // teste de 2 dias
        ultimo_pagamento: null,
        tipo_pagamento: null
      };

      // Salva tudo no Realtime Database
      await set(ref(db, "usuarios/" + user.uid), userData);

      alert("Conta criada com sucesso! 🎉 Aproveite seu teste gratuito de 2 dias!");
      window.location.href = "index.html";
    } catch (error) {
      alert("Erro ao cadastrar: " + traduzErro(error.code));
    }
  });
}

// ===== RECUPERAÇÃO DE SENHA =====
const resetBtn = document.getElementById("reset-btn");
if (resetBtn) {
  resetBtn.addEventListener("click", async () => {
    const email = document.getElementById("login-email").value.trim();
    if (!email) {
      alert("Digite seu e-mail para redefinir a senha!");
      return;
    }

    try {
      await sendPasswordResetEmail(auth, email);
      alert("Um e-mail de redefinição foi enviado! Verifique sua caixa de entrada.");
    } catch (error) {
      alert("Erro ao enviar e-mail: " + traduzErro(error.code));
    }
  });
}

// ===== VERIFICA LOGIN AUTOMÁTICO =====
onAuthStateChanged(auth, (user) => {
  const currentPage = window.location.pathname;
  if (user && currentPage.includes("index.html")) {
    window.location.href = "home.html";
  }
});

// ===== TRADUZ ERROS DO FIREBASE =====
function traduzErro(code) {
  const erros = {
    "auth/invalid-email": "E-mail inválido.",
    "auth/user-disabled": "Usuário desativado.",
    "auth/user-not-found": "Usuário não encontrado.",
    "auth/wrong-password": "Senha incorreta.",
    "auth/email-already-in-use": "Este e-mail já está em uso.",
    "auth/weak-password": "A senha é muito fraca (mínimo 6 caracteres).",
  };
  return erros[code] || "Ocorreu um erro inesperado.";
}

// ===== EXPORTAÇÕES =====
export { auth, db, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, updateProfile, ref, set };
