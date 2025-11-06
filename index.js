const express = require("express");
const app = express();
const path = require("path");

// Diz ao Express pra servir os arquivos da pasta "public"
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(3000, () => {
  console.log("✅ Orion Lab rodando em http://localhost:3000");
});
