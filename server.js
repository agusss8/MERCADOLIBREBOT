import express from "express";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";

const app = express();
app.use(express.json());

const DATA_FILE = path.resolve("./leader_data.json");

// ------------------------
// 🔹 Función para leer/guardar el líder anterior
// ------------------------
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
// 🔹 Obtener competidores de un producto de Catálogo ML
// ------------------------
async function getCompetitors(productId) {
  const url = `https://api.mercadolibre.com/products/${productId}/items`;

  const res = await fetch(url);
  const data = await res.json();

  if (!data || !Array.isArray(data.items)) return [];

  return data.items;
}

// ------------------------
// 🔹 Obtener info de un ítem (para sacar título y precio correcto)
// ------------------------
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

// ------------------------
// 🔹 Función para enviar WhatsApp usando CallMeBot
// ------------------------
async function sendWhatsAppMessage(phone, apiKey, msg) {
  const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encodeURIComponent(msg)}&apikey=${apiKey}`;

  try {
    await fetch(url);
    console.log("Mensaje enviado vía WhatsApp");
  } catch (err) {
    console.error("Error enviando WhatsApp:", err);
  }
}

// ------------------------
// 🔹 Ruta: ver si cambió el líder
// ------------------------
app.get("/leader/check/:productId", async (req, res) => {
  const productId = req.params.productId;

  try {
    const competitors = await getCompetitors(productId);

    if (!competitors.length)
      return res.json({
        error: "No se encontraron competidores"
      });

    // Ordenar por precio ascendente
    const sorted = competitors.sort((a, b) => a.price - b.price);

    // Top 5
    let top5 = sorted.slice(0, 5);

    // Obtener títulos reales
    const top5Full = [];
    for (const item of top5) {
      const info = await getItemInfo(item.item_id);
      top5Full.push(info);
    }

    // El líder actual
    const leader = top5Full[0];

    // Cargar líder previo
    const stored = loadLeader();
    const previousLeader = stored[productId] || null;

    let changed = false;

    if (!previousLeader || previousLeader !== leader.id) {
      changed = true;
      stored[productId] = leader.id;
      saveLeader(stored);

      // Enviar WhatsApp — Configurá tu número y API key acá:
      const PHONE = "5491127145086"; // ← reemplazar
      const APIKEY = "8352737";    // ← reemplazar

      const msg =
        `🔔 *NUEVO LÍDER DETECTADO*\n\n` +
        `Producto catálogo: ${productId}\n` +
        `Nuevo líder: ${leader.title}\n` +
        `Precio: $${leader.price}\n\n` +
        `TOP 5 actual:\n` +
        top5Full
          .map((c, i) => `${i + 1}. ${c.title} — $${c.price}`)
          .join("\n");

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
  res.send("ML Leader Bot funcionando!");
});

// ------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Servidor funcionando en puerto " + PORT);
});
