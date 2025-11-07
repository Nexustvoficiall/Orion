// public/admin.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCJU2wA6lL4aglQIzPrlyYdl_5xaIZqIec",
  authDomain: "orion-lab-a9298.firebaseapp.com",
  databaseURL: "https://orion-lab-a9298-default-rtdb.firebaseio.com",
  projectId: "orion-lab-a9298",
  storageBucket: "orion-lab-a9298.firebasestorage.app",
  messagingSenderId: "421847499235",
  appId: "1:421847499235:web:5c271435a1c9d2fe58a0d6"
};

const ADMIN_EMAIL = "orioncreatoroficial@gmail.com";
const ADMIN_PASSWORD = "fv5kjyuU26022022$";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const inputEmail = document.getElementById("email");
const inputPassword = document.getElementById("password");
const loginBtn = document.getElementById("loginBtn");
const errorMsg = document.getElementById("errorMsg");

loginBtn.addEventListener("click", async () => {
  const email = inputEmail.value.trim();
  const password = inputPassword.value;

  // validação local: só permite o admin
  if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
    errorMsg.textContent = "Email ou senha incorretos!";
    return;
  }

  try {
    // loga no Firebase
    await signInWithEmailAndPassword(auth, email, password);
    // redireciona pro dashboard
    window.location.href = "dashboard.html";
  } catch (err) {
    errorMsg.textContent = "Erro ao logar: " + err.message;
  }
});

// se já estiver logado, vai direto pro dashboard
onAuthStateChanged(auth, (user) => {
  if (user && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
    window.location.href = "dashboard.html";
  }
});
