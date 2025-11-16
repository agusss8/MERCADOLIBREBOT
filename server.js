import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const app = express();
app.use(express.json());

const APP_ID = process.env.APP_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;

// ================================
// 1) REDIRIGE AL LOGIN DE ML
// ================================
app.get("/auth", (req, res) => {
    const mlAuthURL =
        `https://auth.mercadolibre.com.ar/authorization?response_type=code` +
        `&client_id=${APP_ID}&redirect_uri=${REDIRECT_URI}`;

    res.redirect(mlAuthURL);
});

// ================================
// 2) CALLBACK — RECIBE CODE Y OBTIENE TOKENS
// ================================
app.get("/callback", async (req, res) => {
    const { code } = req.query;

    try {
        const response = await axios.post(
            `https://api.mercadolibre.com/oauth/token`,
            {
                grant_type: "authorization_code",
                client_id: APP_ID,
                client_secret: CLIENT_SECRET,
                code: code,
                redirect_uri: REDIRECT_URI
            },
            { headers: { "Content-Type": "application/json" } }
        );

        const tokens = response.data;

        // Guardar tokens en archivo LOCAL
        fs.writeFileSync("tokens.json", JSON.stringify({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_in: tokens.expires_in,
            created_at: Date.now()
        }, null, 2));

        res.send(`
            <h1>Autenticado con éxito! Tokens guardados</h1>
            <pre>${JSON.stringify(tokens, null, 2)}</pre>
        `);

    } catch (error) {
        console.error(error.response?.data || error);
        res.status(500).send("Error al obtener token");
    }
});

// ================================
// 3) FUNCIÓN PARA REFRESCAR TOKEN
// ================================
async function refreshToken() {
    if (!fs.existsSync("tokens.json")) return;

    const data = JSON.parse(fs.readFileSync("tokens.json"));

    const expireTime = data.created_at + (data.expires_in * 1000);
    const now = Date.now();

    // SI AÚN NO EXPIRÓ, NO HACER NADA
    if (now < expireTime) return;

    console.log("⏳ Token expirado. Renovando...");

    const params = new URLSearchParams();
    params.append("grant_type", "refresh_token");
    params.append("client_id", APP_ID);
    params.append("client_secret", CLIENT_SECRET);
    params.append("refresh_token", data.refresh_token);

    try {
        const r = await axios.post("https://api.mercadolibre.com/oauth/token", params);

        fs.writeFileSync("tokens.json", JSON.stringify({
            access_token: r.data.access_token,
            refresh_token: r.data.refresh_token,
            expires_in: r.data.expires_in,
            created_at: Date.now()
        }, null, 2));

        console.log("🔁 Token renovado correctamente");

    } catch (error) {
        console.error("❌ Error al renovar token:", error.response?.data || error);
    }
}

// Ejecutar refresco cada 5 min
setInterval(refreshToken, 5 * 60 * 1000);

// ================================
// 4) RUTA PRINCIPAL
// ================================
app.get("/", (req, res) => {
    res.send("Tu bot de Mercado Libre está funcionando 🎉");
});

// ================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("Servidor activo en puerto " + PORT);
});

// ================================
// VER DATOS DEL USUARIO (PRUEBA)
// ================================
app.get("/me", async (req, res) => {
    try {
        const tokens = JSON.parse(fs.readFileSync("tokens.json"));

        const r = await axios.get("https://api.mercadolibre.com/users/me", {
            headers: {
                Authorization: `Bearer ${tokens.access_token}`
            }
        });

        res.send(r.data);

    } catch (err) {
        console.error(err.response?.data || err);
        res.status(500).send("Error al obtener info del usuario");
    }
});
