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
// AUTH LOGIN
// ================================
app.get("/auth", (req, res) => {
    const mlAuthURL =
        `https://auth.mercadolibre.com.ar/authorization?response_type=code` +
        `&client_id=${APP_ID}&redirect_uri=${REDIRECT_URI}`;

    res.redirect(mlAuthURL);
});

// ================================
// CALLBACK — TOKENS
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

        fs.writeFileSync("tokens.json", JSON.stringify({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_in: tokens.expires_in,
            created_at: Date.now()
        }, null, 2));

        res.send(`<h1>Tokens guardados OK</h1>`);
    } catch (error) {
        console.error(error.response?.data || error);
        res.status(500).send("Error al obtener token");
    }
});

// ================================
// REFRESH TOKEN
// ================================
async function refreshToken() {
    if (!fs.existsSync("tokens.json")) return;

    const data = JSON.parse(fs.readFileSync("tokens.json"));
    const expireTime = data.created_at + (data.expires_in * 1000);

    if (Date.now() < expireTime) return;

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

        console.log("🔁 Token renovado");
    } catch (error) {
        console.error("❌ Error al renovar token:", error.response?.data || error);
    }
}
setInterval(refreshToken, 5 * 60 * 1000);

// ================================
// HOME
// ================================
app.get("/", (req, res) => {
    res.send("Bot Mercado Libre activo 🎉");
});

// ================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("Servidor en puerto " + PORT);
});

// ================================
// INFO USUARIO
// ================================
app.get("/me", async (req, res) => {
    try {
        const tokens = JSON.parse(fs.readFileSync("tokens.json"));
        const r = await axios.get("https://api.mercadolibre.com/users/me", {
            headers: { Authorization: `Bearer ${tokens.access_token}` }
        });

        res.send(r.data);
    } catch (err) {
        console.error(err.response?.data || err);
        res.status(500).send("Error al obtener info del usuario");
    }
});

// ================================
// ITEMS DEL USUARIO
// ================================
app.get("/items", async (req, res) => {
    try {
        const tokens = JSON.parse(fs.readFileSync("tokens.json"));
        const user = await axios.get("https://api.mercadolibre.com/users/me", {
            headers: { Authorization: `Bearer ${tokens.access_token}` }
        });

        const listings = await axios.get(
            `https://api.mercadolibre.com/users/${user.data.id}/items/search`,
            { headers: { Authorization: `Bearer ${tokens.access_token}` } }
        );

        res.send(listings.data);
    } catch (err) {
        console.error(err.response?.data || err);
        res.status(500).send("Error al obtener items");
    }
});

// =====================================================
// ⚡ LEADER CHECK — DETECTA CAMBIO DE LÍDER POR PRECIO
// =====================================================
app.get("/leader/check/:product_id", async (req, res) => {
    const productId = req.params.product_id;

    try {
        const tokenData = JSON.parse(fs.readFileSync("tokens.json"));
        const accessToken = tokenData.access_token;

        // 1 — Obtener competidores del catálogo
        const r = await axios.get(
            `https://api.mercadolibre.com/products/${productId}/items`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        const data = r.data;

        // 2 — Normalizar formatos posibles
        let competitors = [];

        if (Array.isArray(data)) {
            competitors = data;
        } else if (Array.isArray(data.items)) {
            competitors = data.items;
        } else if (Array.isArray(data.results)) {
            competitors = data.results;
        } else {
            return res.status(400).json({
                error: "Formato desconocido de competidores",
                raw: data
            });
        }

        if (competitors.length === 0) {
            return res.json({ error: "No hay competidores" });
        }

        // 3 — Normalizar campos (id, title, price)
        const normalized = [];
        for (const c of competitors) {
            const id = c.id || c.item_id;

            const price =
                c.price ||
                c.sale_price ||
                c.listing_price ||
                null;

            let title = c.title || c.item_title || null;

            if (!title) {
                try {
                    const info = await axios.get(`https://api.mercadolibre.com/items/${id}`);
                    title = info.data.title || "";
                } catch {
                    title = "";
                }
            }

            normalized.push({ id, title, price });
        }

        // 4 — Ordenar por precio ascendente
        const cheapest = normalized
            .filter(x => x.price !== null)
            .sort((a, b) => a.price - b.price);

        if (cheapest.length === 0) {
            return res.json({ error: "No hay precios válidos" });
        }

        const leader = cheapest[0];

        // 5 — Leer líder previo guardado
        let leaders = {};
        if (fs.existsSync("leaders.json")) {
            leaders = JSON.parse(fs.readFileSync("leaders.json"));
        }

        const previous = leaders[productId];

        const changed = previous !== leader.id;

        if (changed) {
            leaders[productId] = leader.id;
            fs.writeFileSync("leaders.json", JSON.stringify(leaders, null, 2));
        }

        // 6 — Respuesta final
        return res.json({
            changed,
            previous_leader: previous || null,
            new_leader: leader.id,
            leader_price: leader.price,
            top5: cheapest.slice(0, 5)
        });

    } catch (error) {
        console.error(error.response?.data || error);
        return res.status(500).json({ error: "Error interno" });
    }
});
