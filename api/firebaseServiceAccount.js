// api/firebaseServiceAccount.js

export default {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID || "orion-lab-a9298",
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID || "2111a1d5f019ec9054811a0e1c55707a48b52911",
  private_key: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  client_email: process.env.FIREBASE_CLIENT_EMAIL || "firebase-adminsdk-fbsvc@orion-lab-a9298.iam.gserviceaccount.com",
  client_id: process.env.FIREBASE_CLIENT_ID || "112850514308646810847",
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL || "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40orion-lab-a9298.iam.gserviceaccount.com",
  universe_domain: "googleapis.com",
};
