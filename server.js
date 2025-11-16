import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const APP_ID = process.env.APP_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;

// ===================================
// 1) REDIRIGE AL LOGIN DE MERCADO LIBRE
// ===================================
app.get("/auth", (req, res) => {
    const mlAuthURL =
        `https://auth.mercadolibre.com.ar/authorization?response_type=code` +
        `&client_id=${APP_ID}&redirect_uri=${REDIRECT_URI}`;

    res.redirect(mlAuthURL);
});

// ===================================
// 2) CALLBACK — RECIBE "code" Y PIDE ACCESS TOKEN
// ===================================
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

        res.send(`
            <h1>Autenticado con éxito!</h1>
            <pre>${JSON.stringify(tokens, null, 2)}</pre>
        `);

    } catch (error) {
        console.error(error.response?.data || error);
        res.status(500).send("Error al obtener token");
    }
});

// ===================================
app.get("/", (req, res) => {
    res.send("Tu bot de Mercado Libre está funcionando 🎉");
});

// ===================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("Servidor activo en puerto " + PORT);
});
