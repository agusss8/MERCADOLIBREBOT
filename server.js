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

// ================================
// OBTENER PUBLICACIONES DEL USUARIO
// ================================
app.get("/items", async (req, res) => {
    try {
        const tokens = JSON.parse(fs.readFileSync("tokens.json"));

        const user = await axios.get("https://api.mercadolibre.com/users/me", {
            headers: {
                Authorization: `Bearer ${tokens.access_token}`
            }
        });

        const userId = user.data.id;

        const listings = await axios.get(`https://api.mercadolibre.com/users/${userId}/items/search`, {
            headers: {
                Authorization: `Bearer ${tokens.access_token}`
            }
        });

        res.send(listings.data);

    } catch (err) {
        console.error(err.response?.data || err);
        res.status(500).send("Error al obtener items");
    }
});

// ===============================================
// OBTENER COMPETIDORES DE UN PRODUCTO DE CATALOGO
// ===============================================
app.get("/competitors/:item_id", async (req, res) => {
    try {
        const tokens = JSON.parse(fs.readFileSync("tokens.json"));
        const { item_id } = req.params;

        // 1) Obtener la publicación para conseguir el product_id
        const itemInfo = await axios.get(`https://api.mercadolibre.com/items/${item_id}`, {
            headers: {
                Authorization: `Bearer ${tokens.access_token}`
            }
        });

        const productId = itemInfo.data.product_id;

        if (!productId) {
            return res.send("❌ Este item NO pertenece a catálogo, no tiene competidores.");
        }

        // 2) Obtener los competidores desde catálogo
        const competitors = await axios.get(`https://api.mercadolibre.com/products/${productId}/listings`, {
            headers: {
                Authorization: `Bearer ${tokens.access_token}`
            }
        });

        res.send({
            product_id: productId,
            competitors: competitors.data
        });

    } catch (err) {
        console.error(err.response?.data || err);
        res.status(500).send("Error al obtener competidores");
    }
});

// ===============================================
// OBTENER COMPETIDORES DADO UN product_id de catálogo
// ===============================================
app.get("/competitors_by_product/:product_id", async (req, res) => {
  try {
    const tokens = JSON.parse(fs.readFileSync("tokens.json"));
    const { product_id } = req.params;

    // Uso del endpoint de Mercado Libre para ver las publicaciones de catálogo que compiten
    const resp = await axios.get(`https://api.mercadolibre.com/products/${product_id}/items`, {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`
      }
    });

    res.send({
      product_id,
      listings: resp.data.results || resp.data
    });

  } catch (err) {
    console.error(err.response?.data || err);
    res.status(500).send("Error al obtener competidores por product_id");
  }
});


// ================================
//  ⚡ LEADER CHECK
// ================================
app.get("/leader/check/:product_id", async (req, res) => {
    const productId = req.params.product_id;

    try {
        const tokenData = JSON.parse(fs.readFileSync("tokens.json"));
        const accessToken = tokenData.access_token;

        // 1 — PEDIR COMPETIDORES DEL PRODUCTO DE CATALOGO
        const r = await axios.get(
            `https://api.mercadolibre.com/products/${productId}/items`,
            {
                headers: { Authorization: `Bearer ${accessToken}` }
            }
        );

        const data = r.data;

        // Normalizamos los competidores
        let competitors = [];

        if (Array.isArray(data)) {
            competitors = data;
        } else if (Array.isArray(data.results)) {
            competitors = data.results;
        } else if (Array.isArray(data.items)) {
            competitors = data.items;
        } else {
            return res.status(400).json({
                error: "Formato desconocido de competidores",
                raw: data
            });
        }

        if (competitors.length === 0) {
            return res.json({ error: "No hay competidores" });
        }

        // 2 — Normalizar atributos
    const normalized = [];

    for (const c of competitors) {
        const id = c.id || c.item_id;

        // Precio directo
        const price = c.price || c.sale_price || c.listing_price || null;

        let title = c.title || c.item_title || null;

        // Si la API NO devolvió título → lo pedimos al endpoint de items
        if (!title) {
            try {
                const info = await axios.get(`https://api.mercadolibre.com/items/${id}`);
                title = info.data.title || "";
            } catch (err) {
                title = "";
            }
        }

        normalized.push({ id, title, price });
    }


        // 3 — Filtrar y ordenar
        const cheapest = normalized
            .filter(x => x.price !== null)
            .sort((a, b) => a.price - b.price);

        if (cheapest.length === 0) {
            return res.json({ error: "No hay precios válidos" });
        }

        const leader = cheapest[0];

        // 4 — Leer líder previo
        let leaders = {};
        if (fs.existsSync("leaders.json")) {
            leaders = JSON.parse(fs.readFileSync("leaders.json"));
        }

        const previous = leaders[productId];

        // 5 — Detectar cambio
        const changed = previous !== leader.id;

        if (changed) {
            leaders[productId] = leader.id;
            fs.writeFileSync("leaders.json", JSON.stringify(leaders, null, 2));
        }

        // 6 — Respuesta
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
