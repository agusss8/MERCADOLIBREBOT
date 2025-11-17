import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import fs from "fs";
import { URLSearchParams } from "url"; // Importación necesaria para URLSearchParams en algunos entornos

dotenv.config();

// --- CONFIGURACIÓN DE LA APLICACIÓN ---
const app = express();
app.use(express.json());

const APP_ID = process.env.APP_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const ITEM_ID_A_MONITOREAR = process.env.ITEM_ID_A_MONITOREAR; // ¡IMPORTANTE! Reemplaza con el ID de tu publicación.
const TELEFONO_WHATSAPP = process.env.TELEFONO_WHATSAPP; // Número para la notificación (formato internacional)

// --- AUTENTICACIÓN MELI (Omitida para brevedad, asumo que las rutas /auth y /callback funcionan) ---
// ... (Tus funciones /auth, /callback, y refreshToken se mantienen intactas) ...

// ================================
// REFRESH TOKEN (Se mantiene tu lógica)
// ================================
async function refreshToken() {
    // ... (Tu función refreshToken va aquí) ...
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

// Ejecutar refresh cada 5 minutos, pero primero al inicio.
refreshToken();
setInterval(refreshToken, 5 * 60 * 1000);

// ================================
// 🔑 FUNCIÓN AUXILIAR: OBTENER NOMBRE DEL VENDEDOR
// ================================

/**
 * Obtiene el 'nickname' de un vendedor usando su ID.
 * @param {string | number} userId
 * @param {string} accessToken
 * @returns {Promise<string>} El nombre o el ID si falla.
 */
async function obtenerNombreVendedor(userId, accessToken) {
    if (!userId) return "N/A";
    try {
        const url = `https://api.mercadolibre.com/users/${userId}`;
        const response = await axios.get(url, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        return response.data.nickname || `ID: ${userId}`;
    } catch (err) {
        // En caso de error (ej: usuario borrado o API rate limit), devolvemos el ID.
        console.error(`Error al obtener nickname para ${userId}:`, err.response?.data || err.message);
        return `ID: ${userId}`;
    }
}

// =====================================================
// 🤖 FUNCIÓN PRINCIPAL: CHEQUEAR, COMPARAR Y NOTIFICAR
// =====================================================

async function chequearCatalogoYNotificar() {
    console.log(`\n--- Chequeo de catálogo (${ITEM_ID_A_MONITOREAR}) ---`);
    if (!fs.existsSync("tokens.json")) {
        console.log("⚠️ No hay token de acceso. Ejecute /auth primero.");
        return;
    }

    try {
        const tokenData = JSON.parse(fs.readFileSync("tokens.json"));
        const accessToken = tokenData.access_token;

        // 1. Obtener competidores (Usamos el endpoint que devuelve la competencia, que incluye seller_id y price)
        // NOTA: Para catálogo, el endpoint más común es /items/{item_id}/catalog_seller_competition
        // Aquí usamos el que devuelve publicaciones asociadas al producto: /products/{id}/items
        const r = await axios.get(
            `https://api.mercadolibre.com/products/${ITEM_ID_A_MONITOREAR}/items`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        const items = r.data.results || r.data.items || [];

        if (items.length === 0) {
            console.log("No se encontraron competidores o publicaciones asociadas.");
            return;
        }

        // 2. Normalizar, obtener el ID del vendedor y el precio
        const competidoresRaw = items.map(item => ({
            seller_id: item.seller_id,
            price: item.price
        }));

        // 3. Ordenar por precio ascendente
        const cheapest = competidoresRaw
            .filter(c => c.price !== null && c.seller_id)
            .sort((a, b) => a.price - b.price);

        if (cheapest.length === 0) {
            console.log("No hay precios válidos o vendedores en la competencia.");
            return;
        }

        const currentLeader = cheapest[0];

        // 4. Leer líder previo guardado
        let leaders = {};
        if (fs.existsSync("leaders.json")) {
            leaders = JSON.parse(fs.readFileSync("leaders.json"));
        }

        const previousLeaderId = leaders[ITEM_ID_A_MONITOREAR];
        const leaderChanged = previousLeaderId !== currentLeader.seller_id;

        // 5. Preparar Top 5 y obtener nombres (hacer esto ANTES de la notificación)
        const top5Promises = cheapest.slice(0, 5).map(async (c, index) => {
            const name = await obtenerNombreVendedor(c.seller_id, accessToken);
            return `${index + 1}. **${name}** ($${c.price.toLocaleString('es-AR')})`;
        });

        const top5NamesAndPrices = await Promise.all(top5Promises);
        const top5Text = top5NamesAndPrices.join('\n');

        // 6. Si el líder cambió: Notificar y actualizar estado.
        if (leaderChanged) {
            const currentLeaderName = await obtenerNombreVendedor(currentLeader.seller_id, accessToken);
            const previousLeaderName = previousLeaderId ? await obtenerNombreVendedor(previousLeaderId, accessToken) : 'NADIE';

            // Actualizar el archivo de estado con el nuevo líder
            leaders[ITEM_ID_A_MONITOREAR] = currentLeader.seller_id;
            fs.writeFileSync("leaders.json", JSON.stringify(leaders, null, 2));

            // --- LÓGICA DE NOTIFICACIÓN DE WHATSAPP (Asumiendo una función de envío) ---
            const notificationMessage = `🚨 **¡CAMBIO DE LÍDER!** 🚨\n\n` +
                                        `Producto: ${ITEM_ID_A_MONITOREAR}\n` +
                                        `Líder anterior: **${previousLeaderName}**\n` +
                                        `Nuevo Líder: **${currentLeaderName}** a **$${currentLeader.price.toLocaleString('es-AR')}**\n\n` +
                                        `--- TOP 5 COMPETIDORES ---\n` +
                                        `${top5Text}`;

            await enviarMensajeWhatsapp(notificationMessage);
            console.log(`✅ ¡Líder cambiado y notificado! Nuevo líder: ${currentLeaderName}`);

        } else {
            console.log(`Líder sin cambios. Actual líder: ${await obtenerNombreVendedor(currentLeader.seller_id, accessToken)}`);
            // Opcional: Notificar el TOP 5 cada 5 minutos aunque no haya cambio.
            // const updateMessage = `🤖 Monitoreo activo. Líder sin cambios.\n\n` + top5Text;
            // await enviarMensajeWhatsapp(updateMessage);
        }

    } catch (error) {
        console.error("❌ Error en el chequeo de catálogo:", error.response?.data || error);
    }
}

// Asegúrate de que dotenv esté importado al inicio del archivo
// const TELEFONO_WHATSAPP = process.env.TELEFONO_WHATSAPP; // Ya está definido arriba

// ================================
// LÓGICA DE ENVÍO DE WHATSAPP CON CALLMEBOT
// ================================

/**
 * Envía un mensaje a través de la API de CallMeBot.
 * @param {string} message - El mensaje formateado a enviar.
 */
async function enviarMensajeWhatsapp(message) {
    const BOT_KEY = process.env.CALLMEBOT_API_KEY;
    const PHONE = process.env.TELEFONO_WHATSAPP;
    
    // Si falta la clave o el teléfono, no podemos enviar el mensaje.
    if (!BOT_KEY || !PHONE) {
        console.error("❌ ERROR: Falta CALLMEBOT_API_KEY o TELEFONO_WHATSAPP en .env");
        return;
    }

    // La URL de CallMeBot usa 'text' y el mensaje debe estar codificado para URL
    const encodedMessage = encodeURIComponent(message);
    
    // Estructura de la URL de CallMeBot:
    const url = `https://api.callmebot.com/whatsapp.php?phone=${PHONE}&text=${encodedMessage}&apikey=${BOT_KEY}`;

    try {
        const response = await axios.get(url);

        if (response.status === 200 && response.data.includes("send")) {
            console.log(`✅ Notificación de WhatsApp enviada OK a ${PHONE} vía CallMeBot.`);
        } else {
            // Manejar posibles errores devueltos por CallMeBot
            console.error(`⚠️ Error al enviar WhatsApp (CallMeBot):`, response.data);
        }
    } catch (error) {
        console.error("❌ Error de conexión al API de CallMeBot:", error.message);
    }
}


// =====================================================
// ⏱️ PROGRAMACIÓN DE TAREAS (SCHEDULER)
// =====================================================

// Ejecutar el chequeo cada 5 minutos (300,000 milisegundos)
const INTERVALO_CHEQUEO = 5 * 60 * 1000;
setInterval(chequearCatalogoYNotificar, INTERVALO_CHEQUEO);

// Ejecutar el chequeo inmediatamente al iniciar el servidor
chequearCatalogoYNotificar();

// --- RUTAS DE EJEMPLO Y STARTUP ---
// ... (Tus rutas /auth, /callback, /me, /items se mantienen para fines de debug) ...
app.get("/", (req, res) => {
    res.send(`Bot Mercado Libre activo 🎉. Monitoreando ${ITEM_ID_A_MONITOREAR} cada 5 minutos.`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("Servidor en puerto " + PORT);
    console.log("Iniciando monitoreo automático...");
});