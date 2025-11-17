import express from "express";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";

const app = express();
app.use(express.json());

// ------------------------
// ARCHIVO DE LÍDERES
// ------------------------
const DATA_FILE = path.resolve("./leader_data.json");

function loadLeader() {
  if (!fs.existsSync(DATA_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveLeader(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ------------------------
// ► TU API ORIGINAL DE MERCADO LIBRE
// ------------------------
app.get("/ml/item/:id", async (req, res) => {
  const id = req.params.id;
  try {
    const r = await fetch(`https://api.mercadolibre.com/items/${id}`);
    const data = await r.json();
    return res.json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error obteniendo item" });
  }
});

app.get("/ml/search/:query", async (req, res) => {
  const query = req.params.query;
  try {
    const r = await fetch(`https://api.mercadolibre.com/sites/MLA/search?q=${query}`);
    const data = await r.json();
    return res.json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error haciendo búsqueda" });
  }
});

// ------------------------
// ► Funciones del BOT
// ------------------------
async function getCompetitors(productId) {
  const url = `https://api.mercadolibre.com/products/${productId}/items`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data || !Array.isArray(data.items)) return [];
  return data.items;
}

async function getItemInfo(itemId) {
  const url = `https://api.mercadolibre.com/items/${itemId}`;
  const res = await fetch(url);
  const info = await res.json();

  return {
    id: itemId,
    title: info.title || "",
    price: info.price || 0
  };
}

async function sendWhatsAppMessage(phone, apiKey, msg) {
  const url =
    `https://api.callmebot.com/whatsapp.php?phone=${phone}` +
    `&text=${encodeURIComponent(msg)}&apikey=${apiKey}`;

  try {
    await fetch(url);
    console.log("Mensaje enviado vía WhatsApp");
  } catch (err) {
    console.error("Error enviando WhatsApp:", err);
  }
}

// ------------------------
// ► Ruta principal del BOT
// ------------------------
app.get("/leader/check/:productId", async (req, res) => {
  const productId = req.params.productId;

  try {
    const competitors = await getCompetitors(productId);

    if (!competitors.length)
      return res.json({ error: "No se encontraron competidores" });

    const sorted = competitors.sort((a, b) => a.price - b.price);

    const top5 = sorted.slice(0, 5);

    let top5Full = [];
    for (const item of top5) {
      const info = await getItemInfo(item.item_id);
      top5Full.push(info);
    }

    const leader = top5Full[0];

    const stored = loadLeader();
    const previousLeader = stored[productId] || null;

    let changed = false;

    if (!previousLeader || previousLeader !== leader.id) {
      changed = true;
      stored[productId] = leader.id;
      saveLeader(stored);

      const PHONE = "5491127145086"; // tu número
      const APIKEY = "8352737"; // tu API key

      const msg =
        `🔔 *NUEVO LÍDER DETECTADO*\n\n` +
        `Producto catálogo: ${productId}\n` +
        `Nuevo líder: ${leader.title}\n` +
        `Precio: $${leader.price}\n\n` +
        `TOP 5:\n` +
        top5Full.map((c, i) => `${i + 1}. ${c.title} — $${c.price}`).join("\n");

      await sendWhatsAppMessage(PHONE, APIKEY, msg);
    }

    return res.json({
      changed,
      previous_leader: previousLeader,
      new_leader: leader.id,
      leader_title: leader.title,
      leader_price: leader.price,
      top5: top5Full
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error interno" });
  }
});

// ------------------------
app.get("/", (req, res) => {
  res.send("ML Leader Bot funcionando con tu API!");
});

// ------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Servidor funcionando en puerto " + PORT);
});
