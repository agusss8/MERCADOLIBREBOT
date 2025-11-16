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

/* ============================================================
   1) LOGIN → REDIRECCIONA A MERCADO LIBRE
   ============================================================ */
app.get("/auth", (req, res) => {
    const mlAuthURL =
        `https://auth.mercadolibre.com.ar/authorization?response_type=code` +
        `&client_id=${APP_ID}&redirect_uri=${REDIRECT_URI}`;

    res.redirect(mlAuthURL);
});

/* ============================================================
   2) CALLBACK → RECIBE CODE Y GUARDA TOKENS
   ============================================================ */
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

        res.send(`
            <h1>¡Autenticado con éxito! Tokens guardados ✔</h1>
            <pre>${JSON.stringify(tokens, null, 2)}</pre>
        `);

    } catch (error) {
        console.error(error.response?.data || error);
        res.status(500).send("Error al obtener token");
    }
});

/* ============================================================
   3) REFRESH TOKEN AUTOMÁTICO
   ============================================================ */
async function refreshToken() {
    if (!fs.existsSync("tokens.json")) return;

    const data = JSON.parse(fs.readFileSync("tokens.json"));

    const expireTime = data.created_at + (data.expires_in * 1000);
    const now = Date.now();

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

        console.log("🔄 Token renovado correctamente");

    } catch (err) {
        console.error("❌ Error al renovar token:", err.response?.data);
    }
}

// refrescar token cada 5 minutos
setInterval(refreshToken, 5 * 60 * 1000);

/* ============================================================
   RUTAS
   ============================================================ */
app.get("/", (req, res) => {
    res.send("🤖 Tu bot ML está activo");
});

/* ============================================================
   INFO DEL USUARIO
   ============================================================ */
app.get("/me", async (req, res) => {
    try {
        const tokens = JSON.parse(fs.readFileSync("tokens.json"));

        const r = await axios.get("https://api.mercadolibre.com/users/me", {
            headers: { Authorization: `Bearer ${tokens.access_token}` }
        });

        res.send(r.data);

    } catch (err) {
        console.error(err.response?.data || err);
        res.status(500).send("Error al obtener usuario");
    }
});

/* ============================================================
   ITEMS PUBLICADOS POR EL USUARIO
   ============================================================ */
app.get("/items", async (req, res) => {
    try {
        const tokens = JSON.parse(fs.readFileSync("tokens.json"));

        const user = await axios.get("https://api.mercadolibre.com/users/me", {
            headers: { Authorization: `Bearer ${tokens.access_token}` }
        });

        const userId = user.data.id;

        const listings = await axios.get(
            `https://api.mercadolibre.com/users/${userId}/items/search`,
            { headers: { Authorization: `Bearer ${tokens.access_token}` } }
        );

        res.send(listings.data);

    } catch (err) {
        console.error(err.response?.data || err);
        res.status(500).send("Error al obtener items");
    }
});

/* ============================================================
   COMPETIDORES DE UN PRODUCTO (ITEM)
   ============================================================ */
app.get("/competitors/:item_id", async (req, res) => {
    try {
        const tokens = JSON.parse(fs.readFileSync("tokens.json"));
        const { item_id } = req.params;

        // obtener product_id
        const itemInfo = await axios.get(
            `https://api.mercadolibre.com/items/${item_id}`,
            { headers: { Authorization: `Bearer ${tokens.access_token}` } }
        );

        const productId = itemInfo.data.product_id;

        if (!productId) {
            return res.send("❌ No es item de catálogo, no tiene competidores");
        }

        // obtener competidores
        const competitors = await axios.get(
            `https://api.mercadolibre.com/products/${productId}/listings`,
            { headers: { Authorization: `Bearer ${tokens.access_token}` } }
        );

        res.send({
            product_id: productId,
            competitors: competitors.data
        });

    } catch (err) {
        console.error(err.response?.data || err);
        res.status(500).send("Error al obtener competidores");
    }
});

/* ============================================================
   COMPETIDORES DADO EL PRODUCT ID
   ============================================================ */
app.get("/competitors_by_product/:product_id", async (req, res) => {
    try {
        const tokens = JSON.parse(fs.readFileSync("tokens.json"));
        const { product_id } = req.params;

        const resp = await axios.get(
            `https://api.mercadolibre.com/products/${product_id}/items`,
            { headers: { Authorization: `Bearer ${tokens.access_token}` } }
        );

        res.send({
            product_id,
            listings: resp.data.results || resp.data
        });

    } catch (err) {
        console.error(err.response?.data || err);
        res.status(500).send("Error al obtener competidores");
    }
});

/* ============================================================
   🔍 LEADER CHECK — TOP 5 + DETECCIÓN DE CAMBIO
   ============================================================ */
app.get("/leader/check/:product_id", async (req, res) => {
    const productId = req.params.product_id;

    try {
        const tokenData = JSON.parse(fs.readFileSync("tokens.json"));
        const accessToken = tokenData.access_token;

        // pedir competidores
        const r = await axios.get(
            `https://api.mercadolibre.com/products/${productId}/items`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        const data = r.data;
        let competitors = [];

        // normalizar formatos
        if (Array.isArray(data)) competitors = data;
        else if (Array.isArray(data.results)) competitors = data.results;
        else if (Array.isArray(data.items)) competitors = data.items;
        else return res.status(400).json({ error: "Formato no esperado", raw: data });

        if (competitors.length === 0) {
            return res.json({ error: "No hay competidores" });
        }

        /* NORMALIZAMOS — precio + título */
        const normalized = [];

        for (const c of competitors) {
            const id = c.id || c.item_id;
            const price = c.price || c.sale_price || c.listing_price || null;

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

        // top ordenado
        const cheapest = normalized
            .filter(x => x.price !== null)
            .sort((a, b) => a.price - b.price);

        const leader = cheapest[0];

        // leer líder anterior
        let leaders = {};
        if (fs.existsSync("leaders.json")) {
            leaders = JSON.parse(fs.readFileSync("leaders.json"));
        }

        const previous = leaders[productId];
        const changed = previous !== leader.id;

        // guardar nuevo líder si cambió
        if (changed) {
            leaders[productId] = leader.id;
            fs.writeFileSync("leaders.json", JSON.stringify(leaders, null, 2));
        }

        res.json({
            changed,
            previous_leader: previous || null,
            new_leader: leader.id,
            leader_title: leader.title,
            leader_price: leader.price,
            top5: cheapest.slice(0, 5).map(x => ({
                id: x.id,
                title: x.title,
                price: x.price
            }))
        });

    } catch (error) {
        console.error(error.response?.data || error);
        res.status(500).json({ error: "Error interno" });
    }
});

/* ============================================================
   SERVER LISTEN
   ============================================================ */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("Servidor activo en puerto " + PORT);
});
