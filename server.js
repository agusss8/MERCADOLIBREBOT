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

// --- AUTENTICACIÓN MELI ---

/**
 * Redirige al usuario a la página de autorización de Mercado Libre.
 */
app.get("/auth", (req, res) => {
    // Asegúrate de que APP_ID y REDIRECT_URI están definidos en tu .env
    const url = `https://auth.mercadolibre.com/authorization?response_type=code&client_id=${APP_ID}&redirect_uri=${REDIRECT_URI}`;
    res.redirect(url);
});

/**
 * Ruta de callback donde Meli redirige después de la autorización.
 * Aquí se obtiene el 'code' para intercambiarlo por el access_token y refresh_token.
 */
app.get("/callback", async (req, res) => {
    const code = req.query.code;

    if (!code) {
        return res.status(400).send("Falta el parámetro 'code' en la URL.");
    }

    // Preparar el cuerpo de la solicitud POST
    const params = new URLSearchParams();
    params.append("grant_type", "authorization_code");
    params.append("client_id", APP_ID);
    params.append("client_secret", CLIENT_SECRET);
    params.append("code", code);
    params.append("redirect_uri", REDIRECT_URI);

    try {
        const response = await axios.post(
            "https://api.mercadolibre.com/oauth/token",
            params,
            { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
        );

        // Guardar los tokens en el archivo
        fs.writeFileSync("tokens.json", JSON.stringify({
            access_token: response.data.access_token,
            refresh_token: response.data.refresh_token,
            expires_in: response.data.expires_in,
            created_at: Date.now()
        }, null, 2));

        res.send("¡Autenticación exitosa! El token ha sido guardado y el monitoreo ha iniciado. Puedes cerrar esta ventana.");
    } catch (error) {
        console.error("❌ Error al obtener el token:", error.response?.data || error);
        res.status(500).send("Error en la autenticación con Mercado Libre.");
    }
});

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

// ... (Tus imports y la configuración inicial de Express, dotenv, etc. se mantienen) ...

// =====================================================
// 🤖 FUNCIÓN PRINCIPAL: CHEQUEAR, COMPARAR Y NOTIFICAR (Modificada)
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

        // 1. Obtener competidores y datos del producto
        const r = await axios.get(
            `https://api.mercadolibre.com/products/${ITEM_ID_A_MONITOREAR}/items`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        const items = r.data.results || r.data.items || [];
        if (items.length === 0) {
            console.log("No se encontraron competidores o publicaciones asociadas.");
            return;
        }

        // 2. Normalizar y obtener el ID del vendedor y el precio
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
        
        // 4. Detección de cambio de líder (mantener esta lógica)
        let leaders = {};
        if (fs.existsSync("leaders.json")) {
            leaders = JSON.parse(fs.readFileSync("leaders.json"));
        }

        const previousLeaderId = leaders[ITEM_ID_A_MONITOREAR];
        const leaderChanged = previousLeaderId !== currentLeader.seller_id;
        
        let headerMessage = "";
        
        // Si hay cambio, actualizamos el estado y preparamos el mensaje de alerta.
        if (leaderChanged) {
            leaders[ITEM_ID_A_MONITOREAR] = currentLeader.seller_id;
            fs.writeFileSync("leaders.json", JSON.stringify(leaders, null, 2));
            
            const previousLeaderName = previousLeaderId ? await obtenerNombreVendedor(previousLeaderId, accessToken) : 'NADIE';
            const currentLeaderName = await obtenerNombreVendedor(currentLeader.seller_id, accessToken);
            
            headerMessage = `🚨 **¡ALERTA DE CAMBIO DE LÍDER!** 🚨\n` +
                            `El nuevo líder es: **${currentLeaderName}** a $${currentLeader.price.toLocaleString('es-AR')}\n` +
                            `Líder anterior: ${previousLeaderName}\n`;
            
            console.log(`✅ ¡Líder cambiado! Nuevo líder: ${currentLeaderName}`);
        } else {
            // Si no hay cambio, preparamos un mensaje de estado rutinario.
            const leaderName = await obtenerNombreVendedor(currentLeader.seller_id, accessToken);
            headerMessage = `🤖 **Reporte Rutinario (5 min)**\n` +
                            `Líder sin cambios: **${leaderName}** a $${currentLeader.price.toLocaleString('es-AR')}\n`;
            
            console.log(`Líder sin cambios. Actual líder: ${leaderName}`);
        }
        
        // 5. Preparar Top 5 (Siempre se calcula para incluirlo en el reporte)
        const top5Promises = cheapest.slice(0, 5).map(async (c, index) => {
            const name = await obtenerNombreVendedor(c.seller_id, accessToken);
            return `${index + 1}. **${name}** ($${c.price.toLocaleString('es-AR')})`;
        });

        const top5NamesAndPrices = await Promise.all(top5Promises);
        const top5Text = top5NamesAndPrices.join('\n');

        // 6. Construir el mensaje FINAL y ENVIAR INCONDICIONALMENTE
        const finalMessage = `${headerMessage}\n` +
                             `--- TOP 5 COMPETIDORES ---\n` +
                             `${top5Text}\n` + 
                             `Producto ID: ${ITEM_ID_A_MONITOREAR}`;

        await enviarMensajeTelegram(finalMessage);
        

    } catch (error) {
        console.error("❌ Error en el chequeo de catálogo:", error.response?.data || error);
    }
}

// ... (El scheduler que llama a chequearCatalogoYNotificar cada 5 minutos se mantiene igual) ...

// Asegúrate de que dotenv esté importado al inicio del archivo
// const TELEFONO_WHATSAPP = process.env.TELEFONO_WHATSAPP; // Ya está definido arriba

// Asegúrate de que dotenv esté cargado al inicio (dotenv.config())
// ...

// =======================================================
// LÓGICA DE ENVÍO DE NOTIFICACIONES A TELEGRAM
// =======================================================

/**
 * Envía un mensaje usando la API de Telegram.
 * @param {string} message - El mensaje formateado a enviar.
 */
async function enviarMensajeTelegram(message) {
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
    
    if (!BOT_TOKEN || !CHAT_ID) {
        console.error("❌ ERROR: Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID en .env");
        return;
    }

    // La API de Telegram soporta Markdown, lo cual es ideal para formatear el mensaje.
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

    try {
        const response = await axios.post(url, {
            chat_id: CHAT_ID,
            text: message,
            parse_mode: 'Markdown' // Permite usar **negritas** y otros formatos.
        });

        if (response.data.ok) {
            console.log(`✅ Notificación de Telegram enviada OK al chat ${CHAT_ID}.`);
        } else {
            console.error(`⚠️ Error al enviar Telegram:`, response.data);
        }
    } catch (error) {
        console.error("❌ Error de conexión al API de Telegram:", error.message);
        if (error.response?.data) {
             console.error("Detalle del error:", error.response.data);
        }
    }
}

// =======================================================
// 🤖 AJUSTE EN LA FUNCIÓN PRINCIPAL
// =======================================================

// DEBES CAMBIAR LA LLAMADA DENTRO de chequearCatalogoYNotificar:
/*
// Línea anterior:
await enviarMensajeWhatsapp(finalMessage);

// Línea nueva:
await enviarMensajeTelegram(finalMessage);
*/


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