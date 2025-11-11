require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { SQLiteDatabase } = require('./db-sqlite');

// Vérifier les variables d'environnement
if (!process.env.BOT_TOKEN) {
    console.error('❌ BOT_TOKEN n\'est pas défini dans le fichier .env');
    process.exit(1);
}

if (!process.env.ADMIN_ID) {
    console.error('❌ ADMIN_ID n\'est pas défini dans le fichier .env');
    process.exit(1);
}

// Initialiser le bot
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const db = new SQLiteDatabase();
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID ? parseInt(process.env.ADMIN_CHAT_ID, 10) : null;
const SHOP_ADMIN_URL = process.env.SHOP_ADMIN_URL || 'https://example.com/admin';

// Attendre que la base de données soit prête
db.db.on('open', () => {
    console.log('✅ Base de données SQLite prête');
});

// États des utilisateurs pour gérer les conversations
const userStates = new Map();

// Historique des messages envoyés par le bot (pour /clear)
const chatMessageHistory = new Map();
function trackBotMessage(chatId, messageId) {
    const list = chatMessageHistory.get(chatId) || [];
    list.push(messageId);
    // Limiter la taille pour éviter une croissance infinie
    if (list.length > 500) list.splice(0, list.length - 500);
    chatMessageHistory.set(chatId, list);
}
async function clearLastBotMessages(chatId, count) {
    const list = chatMessageHistory.get(chatId) || [];
    let deleted = 0;
    for (let i = 0; i < count && list.length > 0; i++) {
        const id = list.pop();
        try {
            await bot.deleteMessage(chatId, id);
            deleted++;
        } catch (err) {
            // Ignorer erreurs (messages trop anciens, permissions manquantes, etc.)
        }
    }
    chatMessageHistory.set(chatId, list);
    return deleted;
}

// Fonction pour convertir les entités Telegram en HTML
function parseMessageEntities(text, entities) {
    if (!entities || entities.length === 0) return text;
    
    // Trier les entités par offset décroissant pour traiter de la fin vers le début
    const sortedEntities = [...entities].sort((a, b) => b.offset - a.offset);
    
    let result = text;
    
    for (const entity of sortedEntities) {
        const start = entity.offset;
        const end = entity.offset + entity.length;
        const entityText = text.substring(start, end);
        
        let replacement = entityText;
        
        switch (entity.type) {
            case 'bold':
                replacement = `<b>${entityText}</b>`;
                break;
            case 'italic':
                replacement = `<i>${entityText}</i>`;
                break;
            case 'underline':
                replacement = `<u>${entityText}</u>`;
                break;
            case 'strikethrough':
                replacement = `<s>${entityText}</s>`;
                break;
            case 'code':
                replacement = `<code>${entityText}</code>`;
                break;
            case 'pre':
                replacement = `<pre>${entityText}</pre>`;
                break;
            case 'text_link':
                replacement = `<a href="${entity.url}">${entityText}</a>`;
                break;
            case 'spoiler':
                replacement = `<span class="tg-spoiler">${entityText}</span>`;
                break;
        }
        
        // Remplacer dans le texte
        result = result.substring(0, start) + replacement + result.substring(end);
    }
    
    return result;
}

// Vérifier si l'utilisateur est admin
async function isAdmin(userId) {
    if (userId.toString() === process.env.ADMIN_ID) return true;
    
    const user = await db.getUser(userId);
    return user?.is_admin === 1;
}

function getAdminCommandsText() {
    return (
        '📜 <b>Commandes d\'administration</b>\n\n' +
        '• /admin — ouvrir le portail d\'administration\n' +
        '• /panel — ouvrir le Panel Bot\n' +
        '• /list — afficher cette liste de commandes\n' +
        '• /stats — afficher les statistiques\n' +
        '• /shortcuts — ouvrir les Raccourcis\n' +
        '• /services — gérer les services\n' +
        '• /miniapp — configurer la mini application\n' +
        '• /social — gérer les réseaux sociaux\n' +
        '• /admins — gérer les administrateurs\n' +
        '• /clear N — supprimer les N derniers messages du bot dans ce chat\n' +
        '• /clear_private_all — supprimer tous les messages du bot en privé\n\n' +
        '<i>Astuce :</i> ajoutez ces commandes dans les <b>Raccourcis</b> pour les exécuter via des boutons.'
    );
}

// Validation d'URL pour WebApp (HTTPS ou localhost/127.0.0.1 en dev)
function isValidWebAppUrl(url) {
    try {
        const u = new URL(url);
        const isLocal = u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
        return !!u.host && (u.protocol === 'https:' || isLocal);
    } catch (e) {
        return false;
    }
}

// Fonction pour envoyer ou éditer un message (gère automatiquement les transitions photo/texte)
async function sendOrEditMessage(chatId, text, keyboard = null, parseMode = 'HTML', messageId = null) {
    const options = {
        parse_mode: parseMode,
        reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined
    };

    if (messageId) {
        try {
            // Essayer d'éditer le message existant
            const result = await bot.editMessageText(text, {
                chat_id: chatId,
                message_id: messageId,
                ...options
            });
            // S'assurer qu'on retourne toujours un objet avec message_id
            try { trackBotMessage(chatId, messageId); } catch (e) {}
            return result.message_id ? result : { message_id: messageId };
        } catch (error) {
            // Si l'édition échoue (probablement passage photo->texte), supprimer et recréer
            try {
                await bot.deleteMessage(chatId, messageId);
            } catch (deleteError) {
                // Ignorer si la suppression échoue
            }
        }
    }

    // Envoyer un nouveau message (supprime le précédent dans le chat admin)
    try {
        if (ADMIN_CHAT_ID && chatId === ADMIN_CHAT_ID) {
            const history = chatMessageHistory.get(chatId);
            if (history && history.length > 0) {
                const lastId = history[history.length - 1];
                try { await bot.deleteMessage(chatId, lastId); } catch (e) {}
                history.pop();
                chatMessageHistory.set(chatId, history);
            }
        }
    } catch (e) {}
    const sent = await bot.sendMessage(chatId, text, options);
    try { trackBotMessage(chatId, sent.message_id); } catch (e) {}
    return sent;
}

// Fonction pour envoyer une photo (gère automatiquement les transitions texte/photo)
async function sendOrEditPhoto(chatId, photo, caption, keyboard = null, messageId = null) {
    const options = {
        caption: caption,
        parse_mode: 'HTML',
        reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined
    };

    if (messageId) {
        try {
            // Essayer d'éditer avec une nouvelle photo
            const result = await bot.editMessageMedia({
                type: 'photo',
                media: photo,
                caption: caption,
                parse_mode: 'HTML'
            }, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined
            });
            // S'assurer qu'on retourne toujours un objet avec message_id
            try { trackBotMessage(chatId, messageId); } catch (e) {}
            return result && result.message_id ? result : { message_id: messageId };
        } catch (error) {
            // Si l'édition échoue (probablement passage texte->photo), supprimer et recréer
            try {
                await bot.deleteMessage(chatId, messageId);
            } catch (deleteError) {
                // Ignorer si la suppression échoue
            }
        }
    }

    // Envoyer une nouvelle photo (supprime le précédent message du bot dans le chat admin)
    try {
        if (ADMIN_CHAT_ID && chatId === ADMIN_CHAT_ID) {
            const history = chatMessageHistory.get(chatId);
            if (history && history.length > 0) {
                const lastId = history[history.length - 1];
                try { await bot.deleteMessage(chatId, lastId); } catch (e) {}
                history.pop();
                chatMessageHistory.set(chatId, history);
            }
        }
    } catch (e) {}
    const sent = await bot.sendPhoto(chatId, photo, options);
    try { trackBotMessage(chatId, sent.message_id); } catch (e) {}
    return sent;
}

// Commande /start
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const firstName = msg.from.first_name || 'utilisateur';

    // Récupérer l'état actuel
    const state = userStates.get(userId) || {};

    // Enregistrer/mettre à jour l'utilisateur
    await db.upsertUser(userId, msg.from.username, msg.from.first_name, msg.from.last_name);
    
    // Enregistrer la statistique
    await db.logEvent('start', userId);

    // Récupérer la configuration
    const config = await db.getConfig();
    
    // Préparer le message d'accueil
    const welcomeText = config.welcome_message.replace('{firstname}', firstName);
    
    // Créer le clavier principal
    const keyboard = [];
    
    // Mini App toujours en première ligne (WebApp avec URL valide)
    if (config.mini_app_url && isValidWebAppUrl(config.mini_app_url)) {
        const btn = { text: config.mini_app_text || '🎮 Ouvrir l\'application' };
        if (msg.chat.type === 'private') {
            btn.web_app = { url: config.mini_app_url };
        } else {
            btn.url = config.mini_app_url;
        }
        keyboard.push([btn]);
    }
    
    // Services avec disposition configurable et activation
    let enabled = ['liv','pos','meet','contact'];
    try {
        if (config.enabled_services) {
            const parsed = JSON.parse(config.enabled_services);
            if (Array.isArray(parsed)) enabled = parsed.filter(c => ['liv','pos','meet','contact'].includes(c));
        }
    } catch (e) {}
    const defs = {
        liv: { text: '🚚 Livraison', callback_data: 'service_liv' },
        pos: { text: '📮 Postal', callback_data: 'service_pos' },
        meet: { text: '📍 Meet Up', callback_data: 'service_meet' },
        contact: { text: '📞 Contact', callback_data: 'service_contact' }
    };
    const serviceButtons = enabled.map(code => defs[code]).filter(Boolean);
    let layout = [];
    try { layout = config.buttons_layout ? JSON.parse(config.buttons_layout) : []; } catch (e) { layout = []; }
    if (!Array.isArray(layout) || layout.length === 0) {
        const perRow = Number.isFinite(config.buttons_per_row) ? Math.max(1, Math.min(3, config.buttons_per_row)) : 1;
        layout = [perRow];
    }
    let idx = 0;
    for (const size of layout) {
        const row = [];
        for (let i = 0; i < size && idx < serviceButtons.length; i++) {
            row.push(serviceButtons[idx++]);
        }
        if (row.length) keyboard.push(row);
    }
    while (idx < serviceButtons.length) {
        keyboard.push([serviceButtons[idx++]]);
    }

    // Boutons personnalisés (configurables)
    let customButtons = [];
    try { customButtons = config.custom_buttons_json ? JSON.parse(config.custom_buttons_json) : []; } catch (e) { customButtons = []; }
    if (Array.isArray(customButtons)) {
        for (let i = 0; i < customButtons.length; i++) {
            const cb = customButtons[i];
            if (cb && cb.is_active !== false) {
                if (cb.type === 'message') {
                    keyboard.push([{ text: cb.label, callback_data: `custombtn_msg_${i}` }]);
                } else if (cb.type === 'url' && cb.value) {
                    keyboard.push([{ text: cb.label, url: cb.value }]);
                } else if (cb.type === 'web_app' && cb.value && isValidWebAppUrl(cb.value)) {
                    const btnX = { text: cb.label };
                    if (msg.chat.type === 'private') { btnX.web_app = { url: cb.value }; } else { btnX.url = cb.value; }
                    keyboard.push([btnX]);
                }
            }
        }
    }
    
    // Réseaux sociaux (un par ligne)
    const socialNetworks = await db.getSocialNetworks();
    if (socialNetworks.length > 0) {
        for (const social of socialNetworks) {
            keyboard.push([
                {
                    text: `${social.emoji} ${social.name}`,
                    url: social.url
                }
            ]);
        }
    }
    
    let result;
    
    // Si on a déjà un messageId, essayer d'éditer
    if (state.messageId) {
        try {
            if (config.welcome_image) {
                result = await sendOrEditPhoto(chatId, config.welcome_image, welcomeText, keyboard, state.messageId);
            } else {
                result = await sendOrEditMessage(chatId, welcomeText, keyboard, 'HTML', state.messageId);
            }
        } catch (error) {
            // Si l'édition échoue, envoyer un nouveau message
            if (config.welcome_image) {
                result = await bot.sendPhoto(chatId, config.welcome_image, {
                    caption: welcomeText,
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: keyboard }
                });
            } else {
                result = await bot.sendMessage(chatId, welcomeText, {
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: keyboard }
                });
            }
        }
    } else {
        // Sinon envoyer un nouveau message
        if (config.welcome_image) {
            result = await bot.sendPhoto(chatId, config.welcome_image, {
                caption: welcomeText,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: keyboard }
            });
        } else {
            result = await bot.sendMessage(chatId, welcomeText, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: keyboard }
            });
        }
    }
    
    // Sauvegarder le messageId
    userStates.set(userId, { ...state, messageId: result.message_id });
});

// Commande /admin
bot.onText(/\/admin/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Récupérer l'état actuel
    const state = userStates.get(userId) || {};

    if (!await isAdmin(userId)) {
        await bot.sendMessage(chatId, '❌ Accès refusé. Cette commande est réservée aux administrateurs.');
        return;
    }
    
    if (ADMIN_CHAT_ID && chatId !== ADMIN_CHAT_ID && msg.chat.type !== 'private') {
        await bot.sendMessage(chatId, "ℹ️ Les commandes d'administration sont disponibles uniquement dans le chat admin (ou en privé).");
        return;
    }
    
    await db.logEvent('admin', userId);
    await showAdminRootMenu(chatId, userId, state.messageId);
});

// Commande /list — afficher les commandes admin
bot.onText(/\/list$/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const state = userStates.get(userId) || {};

    if (!await isAdmin(userId)) {
        await bot.sendMessage(chatId, '❌ Accès refusé. Cette commande est réservée aux administrateurs.');
        return;
    }
    if (ADMIN_CHAT_ID && chatId !== ADMIN_CHAT_ID && msg.chat.type !== 'private') {
        await bot.sendMessage(chatId, "ℹ️ Les commandes d'administration sont disponibles uniquement dans le chat admin (ou en privé).");
        return;
    }

    const text = getAdminCommandsText();
    const keyboard = [
        [{ text: '🤖 Panel Bot Telegram', callback_data: 'admin_open_bot_panel' }],
        [{ text: '🔙 Portail', callback_data: 'admin_root' }]
    ];
    const result = await sendOrEditMessage(chatId, text, keyboard, 'HTML', state.messageId);
    userStates.set(userId, { ...state, messageId: result.message_id });
});

// Commande /clear N — supprimer les N derniers messages du bot dans ce chat
bot.onText(/\/clear(?:\s+(\d+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const state = userStates.get(userId) || {};

    if (!await isAdmin(userId)) {
        await bot.sendMessage(chatId, '❌ Accès refusé. Cette commande est réservée aux administrateurs.');
        return;
    }
    if (ADMIN_CHAT_ID && chatId !== ADMIN_CHAT_ID && msg.chat.type !== 'private') {
        await bot.sendMessage(chatId, "ℹ️ Les commandes d'administration sont disponibles uniquement dans le chat admin (ou en privé).");
        return;
    }

    const count = match && match[1] ? parseInt(match[1], 10) : 5;
    const deleted = await clearLastBotMessages(chatId, isNaN(count) ? 5 : count);
    const confirmKeyboard = [
        [{ text: '⏩ Raccourcis', callback_data: 'admin_shortcuts' }],
        [{ text: '🔙 Portail', callback_data: 'admin_root' }]
    ];
    await sendOrEditMessage(chatId, `🧹 <b>Clear</b>\n\n${deleted} message(s) du bot supprimé(s).`, confirmKeyboard, 'HTML', null);
});

// Clear privé global: supprimer tous les messages du bot dans les chats privés
bot.onText(/\/clear_private_all$/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const state = userStates.get(userId) || {};

    if (!await isAdmin(userId)) {
        await bot.sendMessage(chatId, '❌ Accès refusé. Cette commande est réservée aux administrateurs.');
        return;
    }
    if (ADMIN_CHAT_ID && chatId !== ADMIN_CHAT_ID && msg.chat.type !== 'private') {
        await bot.sendMessage(chatId, "ℹ️ Les commandes d'administration sont disponibles uniquement dans le chat admin (ou en privé).");
        return;
    }

    let totalDeleted = 0;
    let affectedChats = 0;

    for (const [cid, list] of chatMessageHistory.entries()) {
        let chatInfo = null;
        try { chatInfo = await bot.getChat(cid); } catch (e) {}
        if (chatInfo && chatInfo.type === 'private') {
            if (list.length > 0) {
                const deleted = await clearLastBotMessages(cid, list.length);
                totalDeleted += deleted;
                affectedChats++;
            }
        }
    }

    const keyboard = [
        [{ text: '⏩ Raccourcis', callback_data: 'admin_shortcuts' }],
        [{ text: '🔙 Portail', callback_data: 'admin_root' }]
    ];
    await sendOrEditMessage(chatId, `🧹 <b>Clear Privé (global)</b>\n\n${totalDeleted} message(s) supprimé(s) dans ${affectedChats} chat(s) privés.`, keyboard, 'HTML', null);
});

// Commandes admin rapides
bot.onText(/\/panel$/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const state = userStates.get(userId) || {};
    if (!await isAdmin(userId)) { await bot.sendMessage(chatId, '❌ Accès refusé. Cette commande est réservée aux administrateurs.'); return; }
    if (ADMIN_CHAT_ID && chatId !== ADMIN_CHAT_ID && msg.chat.type !== 'private') { await bot.sendMessage(chatId, "ℹ️ Les commandes d'administration sont disponibles uniquement dans le chat admin (ou en privé)."); return; }
    await showAdminMenu(chatId, userId, state.messageId);
});

bot.onText(/\/stats$/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const state = userStates.get(userId) || {};
    if (!await isAdmin(userId)) { await bot.sendMessage(chatId, '❌ Accès refusé. Cette commande est réservée aux administrateurs.'); return; }
    if (ADMIN_CHAT_ID && chatId !== ADMIN_CHAT_ID && msg.chat.type !== 'private') { await bot.sendMessage(chatId, "ℹ️ Les commandes d'administration sont disponibles uniquement dans le chat admin (ou en privé)."); return; }
    const stats = await db.getDetailedStats();
    await sendOrEditMessage(
        chatId,
        `📊 <b>Statistiques détaillées</b>\n\n` +
        `👥 Total utilisateurs: ${stats.totalUsers}\n` +
        `🚀 Démarrages: ${stats.totalStarts}\n` +
        `👨‍💼 Administrateurs: ${stats.totalAdmins}\n` +
        `📅 Utilisateurs aujourd'hui: ${stats.todayUsers}\n` +
        `📈 Utilisateurs cette semaine: ${stats.weekUsers}`,
        [[{ text: '🔙 Retour', callback_data: 'admin_back' }]],
        'HTML',
        state.messageId
    );
});

bot.onText(/\/shortcuts$/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const state = userStates.get(userId) || {};
    if (!await isAdmin(userId)) { await bot.sendMessage(chatId, '❌ Accès refusé. Cette commande est réservée aux administrateurs.'); return; }
    if (ADMIN_CHAT_ID && chatId !== ADMIN_CHAT_ID && msg.chat.type !== 'private') { await bot.sendMessage(chatId, "ℹ️ Les commandes d'administration sont disponibles uniquement dans le chat admin (ou en privé)."); return; }
    const shortcuts = state.shortcuts || [];
    const keyboard = [];
    for (let i = 0; i < shortcuts.length; i++) {
        keyboard.push([{ text: `▶ ${shortcuts[i].label}`, callback_data: `shortcut_run_${i}` }]);
    }
    keyboard.push([{ text: '➕ Ajouter', callback_data: 'shortcut_add' }]);
    if (shortcuts.length > 0) {
        keyboard.push([{ text: '🗑️ Supprimer', callback_data: 'shortcut_delete_list' }]);
    }
    keyboard.push([{ text: '🔙 Portail', callback_data: 'admin_root' }]);
    await sendOrEditMessage(
        chatId,
        '⏩ <b>Raccourcis</b>\n\nCréez des boutons pour vos actions fréquentes.',
        keyboard,
        'HTML',
        state.messageId
    );
});

bot.onText(/\/services$/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const state = userStates.get(userId) || {};
    if (!await isAdmin(userId)) { await bot.sendMessage(chatId, '❌ Accès refusé. Cette commande est réservée aux administrateurs.'); return; }
    if (ADMIN_CHAT_ID && chatId !== ADMIN_CHAT_ID && msg.chat.type !== 'private') { await bot.sendMessage(chatId, "ℹ️ Les commandes d'administration sont disponibles uniquement dans le chat admin (ou en privé)."); return; }
    await sendOrEditMessage(
        chatId,
        '🚚 <b>Gérer les Services</b>\n\n' +
        'Sélectionnez un service à configurer:',
        [
            [{ text: '🚚 LIVRAISON', callback_data: 'edit_service_liv' }],
            [{ text: '📮 POSTAL', callback_data: 'edit_service_pos' }],
            [{ text: '📍 MEET UP', callback_data: 'edit_service_meet' }],
            [{ text: '🔙 Retour', callback_data: 'admin_back' }]
        ],
        'HTML',
        state.messageId
    );
});

bot.onText(/\/miniapp$/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const state = userStates.get(userId) || {};
    if (!await isAdmin(userId)) { await bot.sendMessage(chatId, '❌ Accès refusé. Cette commande est réservée aux administrateurs.'); return; }
    if (ADMIN_CHAT_ID && chatId !== ADMIN_CHAT_ID && msg.chat.type !== 'private') { await bot.sendMessage(chatId, "ℹ️ Les commandes d'administration sont disponibles uniquement dans le chat admin (ou en privé)."); return; }
    const config = await db.getConfig();
    await sendOrEditMessage(
        chatId,
        '📱 <b>Mini Application</b>\n\n' +
        `URL actuelle: ${config.mini_app_url || 'Non définie'}\n` +
        `Texte du bouton: ${config.mini_app_text || '🎮 Ouvrir l\'application'}`,
        [
            [{ text: '🔗 Modifier URL', callback_data: 'edit_miniapp_url' }],
            [{ text: '✏️ Modifier Texte', callback_data: 'edit_miniapp_text' }],
            [{ text: '🔙 Retour', callback_data: 'admin_back' }]
        ],
        'HTML',
        state.messageId
    );
});

bot.onText(/\/social$/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const state = userStates.get(userId) || {};
    if (!await isAdmin(userId)) { await bot.sendMessage(chatId, '❌ Accès refusé. Cette commande est réservée aux administrateurs.'); return; }
    if (ADMIN_CHAT_ID && chatId !== ADMIN_CHAT_ID && msg.chat.type !== 'private') { await bot.sendMessage(chatId, "ℹ️ Les commandes d'administration sont disponibles uniquement dans le chat admin (ou en privé)."); return; }
    await showSocialMenu(chatId, userId, state.messageId);
});

bot.onText(/\/admins$/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const state = userStates.get(userId) || {};
    if (!await isAdmin(userId)) { await bot.sendMessage(chatId, '❌ Accès refusé. Cette commande est réservée aux administrateurs.'); return; }
    if (ADMIN_CHAT_ID && chatId !== ADMIN_CHAT_ID && msg.chat.type !== 'private') { await bot.sendMessage(chatId, "ℹ️ Les commandes d'administration sont disponibles uniquement dans le chat admin (ou en privé)."); return; }
    await showAdminManagement(chatId, userId, state.messageId);
});

// Commande de debug: afficher l'ID du chat et de l'utilisateur (admin seulement)
bot.onText(/\/chatid$/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (!await isAdmin(userId)) { return; }
    await bot.sendMessage(chatId, `Chat ID: ${chatId}\nVotre ID: ${userId}`);
});

// Afficher le menu admin
async function showAdminMenu(chatId, userId, messageId = null) {
    const config = await db.getConfig();
    const stats = await db.getStats();
    
    const keyboard = [
        [{ text: '✏️ Message d\'accueil', callback_data: 'admin_welcome' }],
        [{ text: '🖼️ Photo d\'accueil', callback_data: 'admin_photo' }],
        [{ text: '📱 Mini Application', callback_data: 'admin_miniapp' }],
        [{ text: '🔗 Gérer Réseaux Sociaux', callback_data: 'admin_social' }],
        [{ text: '🚚 Gérer Services', callback_data: 'admin_services' }],
        [{ text: '➕➖ Créer/Supprimer services (/start)', callback_data: 'admin_services_visibility' }],
        [{ text: '🎛️ Disposition des boutons', callback_data: 'admin_layout' }],
        [{ text: '🧩 Ordonner les services', callback_data: 'admin_arrange' }],
        [{ text: '🔘 Boutons personnalisés', callback_data: 'admin_custom_buttons' }],
        [{ text: '📊 Statistiques', callback_data: 'admin_stats' }],
        [{ text: '👥 Gérer Admins', callback_data: 'admin_manage' }],
        [{ text: '📢 Broadcast', callback_data: 'admin_broadcast' }],
        [{ text: '🔙 Portail', callback_data: 'admin_root' }]
    ];
    
    const text = `🔧 <b>Panel d'Administration</b>\n\n` +
                 `👥 Utilisateurs: ${stats.totalUsers}\n` +
                 `📊 Démarrages: ${stats.totalStarts}\n` +
                 `👨‍💼 Admins: ${stats.totalAdmins}`;
    
    const state = userStates.get(userId) || {};
    const result = await sendOrEditMessage(chatId, text, keyboard, 'HTML', messageId || state.messageId);
    userStates.set(userId, { ...state, messageId: result.message_id });
}

// Nouveau: Menu racine d'administration
async function showAdminRootMenu(chatId, userId, messageId = null) {
    const stats = await db.getStats();
    const text = `🧭 <b>Portail d'Administration</b>\n\n` +
                 `👥 Utilisateurs: ${stats.totalUsers}\n` +
                 `📊 Démarrages: ${stats.totalStarts}\n` +
                 `👨‍💼 Admins: ${stats.totalAdmins}\n\n` +
                 `Choisissez une section :`;

    const keyboard = [];
    if (SHOP_ADMIN_URL) {
        keyboard.push([{ text: '🛒 Panel Admin Boutique', url: SHOP_ADMIN_URL }]);
    }
    keyboard.push([{ text: '🤖 Panel Bot Telegram', callback_data: 'admin_open_bot_panel' }]);
    keyboard.push([{ text: '📜 Liste des commandes', callback_data: 'admin_commands_list' }]);
    keyboard.push([{ text: '⏩ Raccourcis', callback_data: 'admin_shortcuts' }]);
    keyboard.push([{ text: '➕ Créer un compte admin', callback_data: 'admin_create_account' }]);
    keyboard.push([{ text: '🔙 Retour au menu', callback_data: 'back_to_start' }]);

    const state = userStates.get(userId) || {};
    const result = await sendOrEditMessage(chatId, text, keyboard, 'HTML', messageId || state.messageId);
    userStates.set(userId, { ...state, messageId: result.message_id });
}

// Gestion des callbacks
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const messageId = query.message.message_id;
    const data = query.data;
    
    // Mettre à jour l'état avec le messageId
    const state = userStates.get(userId) || {};
    userStates.set(userId, { ...state, messageId: messageId });
    
    // Répondre au callback
    try {
        await bot.answerCallbackQuery(query.id);
    } catch (err) {
        // Ignorer les callbacks expirés pour éviter les crashs au redémarrage
        const desc = err?.response?.body?.description || err.message || String(err);
        if (!/query is too old|query ID is invalid|timeout expired/i.test(desc)) {
            console.error('Erreur answerCallbackQuery:', desc);
        }
    }

    // Restriction: bloquer les callbacks admin hors du chat admin
    const adminPrefixes = [
        'admin_',
        'edit_service_',
        'manage_submenus_',
        'edit_submenu_',
        'delete_submenu_',
        'add_submenu_',
        'edit_social_',
        'delete_social_',
        'confirm_remove_admin_',
        'shortcut_'
    ];
    const adminExact = ['add_admin','remove_admin','add_social','edit_miniapp_url','edit_miniapp_text'];
    const isAdminAction = adminPrefixes.some(p => data.startsWith(p)) || adminExact.includes(data);
    if (isAdminAction) {
        if (!await isAdmin(userId)) {
            await bot.sendMessage(chatId, '❌ Accès refusé. Cette action est réservée aux administrateurs.');
            return;
        }
        if (ADMIN_CHAT_ID && chatId !== ADMIN_CHAT_ID && query.message.chat.type !== 'private') {
            await bot.sendMessage(chatId, "⚠️ Action d'administration seulement dans le groupe d'administration ou en privé.");
            return;
        }
    }

    switch(data) {
        // Menu principal
        case 'back_to_start':
            // Récupérer la configuration
            const config = await db.getConfig();
            const firstName = query.from.first_name || 'utilisateur';
            const welcomeText = config.welcome_message.replace('{firstname}', firstName);
            
            // Créer le clavier principal
            const keyboard = [];
            
            // Mini App toujours en première ligne (WebApp avec URL valide)
            if (config.mini_app_url && isValidWebAppUrl(config.mini_app_url)) {
                const btn2 = { text: config.mini_app_text || '🎮 Ouvrir l\'application' };
                if (query.message.chat.type === 'private') {
                    btn2.web_app = { url: config.mini_app_url };
                } else {
                    btn2.url = config.mini_app_url;
                }
                keyboard.push([btn2]);
            }
            
            // Services activés avec disposition configurable
            let enabled = ['liv','pos','meet','contact'];
            try {
                if (config.enabled_services) {
                    const parsed = JSON.parse(config.enabled_services);
                    if (Array.isArray(parsed)) enabled = parsed.filter(c => ['liv','pos','meet','contact'].includes(c));
                }
            } catch (e) {}
            const defs = {
                liv: { text: '🚚 Livraison', callback_data: 'service_liv' },
                pos: { text: '📮 Postal', callback_data: 'service_pos' },
                meet: { text: '📍 Meet Up', callback_data: 'service_meet' },
                contact: { text: '📞 Contact', callback_data: 'service_contact' }
            };
            const serviceButtons = enabled.map(code => defs[code]).filter(Boolean);
            let layout = [];
            try { layout = config.buttons_layout ? JSON.parse(config.buttons_layout) : []; } catch (e) { layout = []; }
            if (!Array.isArray(layout) || layout.length === 0) {
                const perRow = Number.isFinite(config.buttons_per_row) ? Math.max(1, Math.min(3, config.buttons_per_row)) : 1;
                layout = [perRow];
            }
            let idx2 = 0;
            for (const size of layout) {
                const row = [];
                for (let i = 0; i < size && idx2 < serviceButtons.length; i++) {
                    row.push(serviceButtons[idx2++]);
                }
                if (row.length) keyboard.push(row);
            }
            while (idx2 < serviceButtons.length) {
                keyboard.push([serviceButtons[idx2++]]);
            }
            
            // Boutons personnalisés (configurables)
            let customButtons = [];
            try { customButtons = config.custom_buttons_json ? JSON.parse(config.custom_buttons_json) : []; } catch (e) { customButtons = []; }
            if (Array.isArray(customButtons)) {
                for (let i = 0; i < customButtons.length; i++) {
                    const cb = customButtons[i];
                    if (cb && cb.is_active !== false) {
                        if (cb.type === 'message') {
                            keyboard.push([{ text: cb.label, callback_data: `custombtn_msg_${i}` }]);
                        } else if (cb.type === 'url' && cb.value) {
                            keyboard.push([{ text: cb.label, url: cb.value }]);
                        } else if (cb.type === 'web_app' && cb.value && isValidWebAppUrl(cb.value)) {
                            const btnX = { text: cb.label };
                            if (query.message.chat.type === 'private') { btnX.web_app = { url: cb.value }; } else { btnX.url = cb.value; }
                            keyboard.push([btnX]);
                        }
                    }
                }
            }

            // Réseaux sociaux (un par ligne)
            const socialNetworks = await db.getSocialNetworks();
            if (socialNetworks.length > 0) {
                for (const social of socialNetworks) {
                    keyboard.push([
                        {
                            text: `${social.emoji} ${social.name}`,
                            url: social.url
                        }
                    ]);
                }
            }
            
            
            // Envoyer le message
            let result;
            if (config.welcome_image) {
                result = await sendOrEditPhoto(chatId, config.welcome_image, welcomeText, keyboard, messageId);
            } else {
                result = await sendOrEditMessage(chatId, welcomeText, keyboard, 'HTML', messageId);
            }
            
            // Mettre à jour le messageId dans l'état
            const newState = { ...state };
            delete newState.state;
            userStates.set(userId, { ...newState, messageId: result.message_id });
            break;
            
            
        // Services
        case 'service_liv':
            await showService(chatId, userId, 'livraison', messageId);
            break;
            
        case 'service_pos':
            await showService(chatId, userId, 'postal', messageId);
            break;
            
        case 'service_meet':
            await showService(chatId, userId, 'meetup', messageId);
            break;
            
        case 'service_contact':
            userStates.set(userId, { ...state, state: 'waiting_contact_message' });
            await sendOrEditMessage(
                chatId,
                '📩 Envoyez votre message de contact. Nous le recevrons dans notre groupe privé.\n\nVous pouvez écrire du texte ou envoyer une photo/voix/vidéo.',
                [[{ text: '🔙 Retour', callback_data: 'back_to_start' }]],
                'HTML',
                messageId
            );
            break;
            
        // Admin
        case 'admin_back':
            if (await isAdmin(userId)) {
                await showAdminMenu(chatId, userId, messageId);
            }
            break;

        case 'admin_open_bot_panel':
            if (await isAdmin(userId)) {
                await showAdminMenu(chatId, userId, messageId);
            }
            break;

        case 'admin_commands_list':
            if (await isAdmin(userId)) {
                const text = getAdminCommandsText();
                const keyboard = [
                    [{ text: '🤖 Panel Bot Telegram', callback_data: 'admin_open_bot_panel' }],
                    [{ text: '🔙 Portail', callback_data: 'admin_root' }]
                ];
                await sendOrEditMessage(chatId, text, keyboard, 'HTML', messageId);
            }
            break;

        case 'admin_shortcuts':
            if (await isAdmin(userId)) {
                const shortcuts = (userStates.get(userId)?.shortcuts) || [];
                const keyboard = [];
                for (let i = 0; i < shortcuts.length; i++) {
                    keyboard.push([{ text: `▶ ${shortcuts[i].label}`, callback_data: `shortcut_run_${i}` }]);
                }
                keyboard.push([{ text: '➕ Ajouter', callback_data: 'shortcut_add' }]);
                if (shortcuts.length > 0) {
                    keyboard.push([{ text: '🗑️ Supprimer', callback_data: 'shortcut_delete_list' }]);
                }
                keyboard.push([{ text: '🔙 Portail', callback_data: 'admin_root' }]);
                await sendOrEditMessage(
                    chatId,
                    '⏩ <b>Raccourcis</b>\n\nCréez des boutons pour vos actions fréquentes.',
                    keyboard,
                    'HTML',
                    messageId
                );
            }
            break;

        case 'admin_root':
            if (await isAdmin(userId)) {
                await showAdminRootMenu(chatId, userId, messageId);
            }
            break;

        case 'admin_create_account':
            if (await isAdmin(userId)) {
                userStates.set(userId, { ...state, state: 'adding_admin' });
                await sendOrEditMessage(
                    chatId,
                    '➕ <b>Créer un compte admin</b>\n\nEnvoyez l\'ID utilisateur à ajouter.',
                    [[{ text: '❌ Annuler', callback_data: 'admin_manage' }]],
                    'HTML',
                    messageId
                );
            }
            break;
            
        case 'admin_welcome':
            if (await isAdmin(userId)) {
                userStates.set(userId, { ...state, state: 'waiting_welcome' });
                await sendOrEditMessage(
                    chatId,
                    '✏️ <b>Modifier le message d\'accueil</b>\n\n' +
                    'Envoyez le nouveau message.\n' +
                    'Utilisez {firstname} pour inclure le prénom.\n\n' +
                    '💡 <i>Astuce: Sélectionnez votre texte et utilisez le menu de formatage Telegram</i>',
                    [[{ text: '❌ Annuler', callback_data: 'admin_back' }]],
                    'HTML',
                    messageId
                );
            }
            break;
            
        case 'admin_photo':
            if (await isAdmin(userId)) {
                userStates.set(userId, { ...state, state: 'waiting_photo' });
                await sendOrEditMessage(
                    chatId,
                    '🖼️ <b>Modifier la photo d\'accueil</b>\n\n' +
                    'Envoyez la nouvelle photo.',
                    [[{ text: '❌ Annuler', callback_data: 'admin_back' }]],
                    'HTML',
                    messageId
                );
            }
            break;
            
        case 'admin_miniapp':
            if (await isAdmin(userId)) {
                const config = await db.getConfig();
                await sendOrEditMessage(
                    chatId,
                    '📱 <b>Mini Application</b>\n\n' +
                    `URL actuelle: ${config.mini_app_url || 'Non définie'}\n` +
                    `Texte du bouton: ${config.mini_app_text || '🎮 Ouvrir l\'application'}`,
                    [
                        [{ text: '🔗 Modifier URL', callback_data: 'edit_miniapp_url' }],
                        [{ text: '✏️ Modifier Texte', callback_data: 'edit_miniapp_text' }],
                        [{ text: '🔙 Retour', callback_data: 'admin_back' }]
                    ],
                    'HTML',
                    messageId
                );
            }
            break;
            
        case 'admin_social':
            if (await isAdmin(userId)) {
                await showSocialMenu(chatId, userId, messageId);
            }
            break;
            
        case 'admin_services':
            if (await isAdmin(userId)) {
                await sendOrEditMessage(
                    chatId,
                    '🚚 <b>Gérer les Services</b>\n\n' +
                    'Sélectionnez un service à configurer:',
                    [
                        [{ text: '🚚 LIVRAISON', callback_data: 'edit_service_liv' }],
                        [{ text: '📮 POSTAL', callback_data: 'edit_service_pos' }],
                        [{ text: '📍 MEET UP', callback_data: 'edit_service_meet' }],
                        [{ text: '🔙 Retour', callback_data: 'admin_back' }]
                    ],
                    'HTML',
                    messageId
                );
            }
            break;

        case 'admin_services_visibility':
            if (await isAdmin(userId)) {
                const config = await db.getConfig();
                let enabled = ['liv','pos','meet','contact'];
                try {
                    if (config.enabled_services) {
                        const parsed = JSON.parse(config.enabled_services);
                        if (Array.isArray(parsed)) enabled = parsed.filter(c => ['liv','pos','meet','contact'].includes(c));
                    }
                } catch (e) {}

                const defs = [
                    { code: 'liv', label: '🚚 LIVRAISON' },
                    { code: 'pos', label: '📮 POSTAL' },
                    { code: 'meet', label: '📍 MEET UP' },
                    { code: 'contact', label: '📞 CONTACT' }
                ];
                const keyboard = defs.map(d => [{
                    text: `${d.label} — ${enabled.includes(d.code) ? '✅ ON' : '❌ OFF'}`,
                    callback_data: `toggle_service_${d.code}`
                }]);
                keyboard.push([{ text: '🔙 Retour', callback_data: 'admin_back' }]);

                const text = '👁️ <b>Créer/Supprimer services du menu /start</b>\n\n' +
                    'Cliquez pour activer/désactiver l\'affichage des services dans /start.';
                await sendOrEditMessage(chatId, text, keyboard, 'HTML', messageId);
            }
            break;
            
        case 'admin_layout':
            if (await isAdmin(userId)) {
                const config = await db.getConfig();
                const defaultPerRow = Number.isFinite(config.buttons_per_row) ? Math.max(1, Math.min(3, config.buttons_per_row)) : 1;
                let layoutText = `Non définie (par défaut ${defaultPerRow} par ligne)`;
                try {
                    if (config.buttons_layout) {
                        const arr = JSON.parse(config.buttons_layout);
                        if (Array.isArray(arr) && arr.length) layoutText = arr.join(', ');
                    }
                } catch (e) {}
                await sendOrEditMessage(
                    chatId,
                    '🎛️ <b>Disposition des boutons</b>\n\n' +
                    `Disposition actuelle (services): ${layoutText}\n\n` +
                    'Envoyez une liste de nombres séparés par des virgules.\n' +
                    'Exemple: "2,1" pour 3 services (ligne 1: 2 boutons, ligne 2: 1 bouton).',
                    [
                        [{ text: '✏️ Modifier', callback_data: 'edit_buttons_layout' }],
                        [{ text: '🔙 Retour', callback_data: 'admin_back' }]
                    ],
                    'HTML',
                    messageId
                );
            }
            break;
        
        case 'edit_buttons_layout':
            if (await isAdmin(userId)) {
                const st = userStates.get(userId) || {};
                userStates.set(userId, { ...st, state: 'waiting_layout_input' });
                await sendOrEditMessage(
                    chatId,
                    '✏️ Envoyez la disposition souhaitée sous forme "2,1,1" (chiffres 1–3).',
                    [[{ text: '❌ Annuler', callback_data: 'admin_back' }]],
                    'HTML',
                    messageId
                );
            }
            break;
            
        case 'admin_stats':
            if (await isAdmin(userId)) {
                const stats = await db.getDetailedStats();
                await sendOrEditMessage(
                    chatId,
                    `📊 <b>Statistiques détaillées</b>\n\n` +
                    `👥 Total utilisateurs: ${stats.totalUsers}\n` +
                    `🚀 Démarrages: ${stats.totalStarts}\n` +
                    `👨‍💼 Administrateurs: ${stats.totalAdmins}\n` +
                    `📅 Utilisateurs aujourd'hui: ${stats.todayUsers}\n` +
                    `📈 Utilisateurs cette semaine: ${stats.weekUsers}`,
                    [[{ text: '🔙 Retour', callback_data: 'admin_back' }]],
                    'HTML',
                    messageId
                );
            }
            break;
            
        case 'admin_manage':
            if (await isAdmin(userId)) {
                await showAdminManagement(chatId, userId, messageId);
            }
            break;
            
        case 'admin_broadcast':
            if (await isAdmin(userId)) {
                userStates.set(userId, { ...state, state: 'waiting_broadcast' });
                await sendOrEditMessage(
                    chatId,
                    '📢 <b>Envoyer un message à tous</b>\n\n' +
                    'Envoyez le message que vous voulez diffuser à tous les utilisateurs.',
                    [[{ text: '❌ Annuler', callback_data: 'admin_back' }]],
                    'HTML',
                    messageId
                );
            }
            break;

        // Raccourcis
        case 'shortcut_add':
            if (await isAdmin(userId)) {
                userStates.set(userId, { ...state, state: 'shortcut_waiting_action' });
                const actions = [
                    { text: '🤖 Panel Bot', action: 'admin_open_bot_panel' },
                    { text: '📜 Liste des commandes', action: 'admin_commands_list' },
                    { text: '🧹 Clear 5', action: 'admin_clear_5' },
                    { text: '🧹 Clear 10', action: 'admin_clear_10' },
                    { text: '🧹 Clear 20', action: 'admin_clear_20' },
                    { text: '📊 Statistiques', action: 'admin_stats' },
                    { text: '👥 Gérer Admins', action: 'admin_manage' },
                    { text: '📢 Broadcast', action: 'admin_broadcast' },
                    { text: '🚚 Gérer Services', action: 'admin_services' },
                    { text: '📱 Mini Application', action: 'admin_miniapp' },
                    { text: '🔗 Réseaux Sociaux', action: 'admin_social' },
                    { text: '✏️ Message d\'accueil', action: 'admin_welcome' },
                    { text: '🖼️ Photo d\'accueil', action: 'admin_photo' }
                ];
                const keyboard = actions.map(a => [{ text: a.text, callback_data: `shortcut_pick_action_${a.action}` }]);
                keyboard.push([{ text: '❌ Annuler', callback_data: 'admin_shortcuts' }]);
                await sendOrEditMessage(
                    chatId,
                    'Sélectionnez l\'action pour le raccourci :',
                    keyboard,
                    'HTML',
                    messageId
                );
            }
            break;

        case 'shortcut_delete_list':
            if (await isAdmin(userId)) {
                const shortcuts = (userStates.get(userId)?.shortcuts) || [];
                const keyboard = [];
                for (let i = 0; i < shortcuts.length; i++) {
                    keyboard.push([{ text: `🗑️ ${shortcuts[i].label}`, callback_data: `shortcut_delete_${i}` }]);
                }
                keyboard.push([{ text: '🔙 Retour', callback_data: 'admin_shortcuts' }]);
                await sendOrEditMessage(chatId, 'Sélectionnez le raccourci à supprimer :', keyboard, 'HTML', messageId);
            }
            break;

        // Gestion des services détaillés
        case 'edit_service_liv':
        case 'edit_service_pos':
        case 'edit_service_meet':
            if (await isAdmin(userId)) {
                const serviceType = data.replace('edit_service_', '');
                await showServiceEditMenu(chatId, userId, serviceType, messageId);
            }
            break;
            
        // Autres callbacks
        default:
            await handleOtherCallbacks(query);
    }
});

// Afficher un service avec ses sous-menus
async function showService(chatId, userId, serviceType, messageId) {
    const config = await db.getConfig();
    const submenus = await db.getServiceSubmenus(serviceType);
    
    let text, image;
    switch(serviceType) {
        case 'livraison':
            text = config.livraison_text;
            image = config.livraison_image;
            break;
        case 'postal':
            text = config.postal_text;
            image = config.postal_image;
            break;
        case 'meetup':
            text = config.meetup_text;
            image = config.meetup_image;
            break;
    }
    
    const keyboard = [];
    
    // Ajouter les sous-menus
    for (const submenu of submenus) {
        keyboard.push([{ 
            text: submenu.name, 
            callback_data: `submenu_${serviceType}_${submenu.id}` 
        }]);
    }
    
    keyboard.push([{ text: '🔙 Retour au menu', callback_data: 'back_to_start' }]);
    
    const state = userStates.get(userId) || {};
    
    let result;
    if (image) {
        result = await sendOrEditPhoto(chatId, image, text, keyboard, messageId);
    } else {
        result = await sendOrEditMessage(chatId, text, keyboard, 'HTML', messageId);
    }
    
    // Sauvegarder le messageId pour les futures éditions
    userStates.set(userId, { ...state, messageId: result.message_id || messageId });
}

// Afficher le menu d'édition d'un service
async function showServiceEditMenu(chatId, userId, serviceType, messageId) {
    const serviceName = serviceType === 'liv' ? 'LIVRAISON' : 
                       serviceType === 'pos' ? 'POSTAL' : 'MEET UP';
                       
    const fullServiceType = serviceType === 'liv' ? 'livraison' : 
                           serviceType === 'pos' ? 'postal' : 'meetup';
    
    await sendOrEditMessage(
        chatId,
        `✏️ <b>SERVICE ${serviceName}</b>\n\nQue voulez-vous modifier ?`,
        [
            [{ text: '📝 Texte principal', callback_data: `edit_text_${serviceType}` }],
            [{ text: '🖼️ Photo principale', callback_data: `edit_photo_${serviceType}` }],
            [{ text: '📋 Gérer sous-menus', callback_data: `manage_submenus_${serviceType}` }],
            [{ text: '🔙 Retour', callback_data: 'admin_services' }]
        ],
        'HTML',
        messageId
    );
}

// Afficher le menu des réseaux sociaux
async function showSocialMenu(chatId, userId, messageId) {
    const socialNetworks = await db.getSocialNetworks();
    
    const keyboard = [];
    
    // Afficher les réseaux existants
    for (const social of socialNetworks) {
        keyboard.push([{ 
            text: `${social.emoji} ${social.name}`, 
            callback_data: `edit_social_${social.id}` 
        }]);
    }
    
    keyboard.push([{ text: '➕ Ajouter un réseau', callback_data: 'add_social' }]);
    keyboard.push([{ text: '🔙 Retour', callback_data: 'admin_back' }]);
    
    await sendOrEditMessage(
        chatId,
        '🔗 <b>Gérer les Réseaux Sociaux</b>\n\n' +
        'Cliquez sur un réseau pour le modifier ou utilisez les options ci-dessous.',
        keyboard,
        'HTML',
        messageId
    );
}

// Afficher la gestion des admins
async function showAdminManagement(chatId, userId, messageId) {
    const admins = await db.getAdmins();
    
    let text = '👥 <b>Gestion des Administrateurs</b>\n\n';
    
    if (admins.length === 0) {
        text += '<i>Aucun administrateur trouvé</i>\n';
    } else {
        text += '<b>Administrateurs actuels :</b>\n';
        for (const admin of admins) {
            const isMainAdmin = admin.user_id.toString() === process.env.ADMIN_ID;
            const adminMark = isMainAdmin ? ' 👑' : '';
            text += `• ${admin.first_name || 'Admin'} `;
            if (admin.username) {
                text += `(@${admin.username})`;
            } else {
                text += `(ID: ${admin.user_id})`;
            }
            text += adminMark + '\n';
        }
        text += '\n<i>👑 = Administrateur principal (non supprimable)</i>';
    }
    
    const keyboard = [
        [{ text: '➕ Ajouter un admin', callback_data: 'add_admin' }],
        [{ text: '❌ Retirer un admin', callback_data: 'remove_admin' }],
        [{ text: '🔙 Retour', callback_data: 'admin_back' }]
    ];
    
    await sendOrEditMessage(chatId, text, keyboard, 'HTML', messageId);
}

// Ordonner les services et régler le nombre par ligne
async function showArrangeServicesMenu(chatId, userId, messageId) {
    const config = await db.getConfig();
    let enabled = ['liv','pos','meet','contact'];
    try {
        if (config.enabled_services) {
            const parsed = JSON.parse(config.enabled_services);
            if (Array.isArray(parsed)) enabled = parsed.filter(c => ['liv','pos','meet','contact'].includes(c));
        }
    } catch (e) {}

    const labels = {
        liv: '🚚 LIVRAISON',
        pos: '📮 POSTAL',
        meet: '📍 MEET UP',
        contact: '📞 CONTACT'
    };

    const keyboard = [];
    for (const code of enabled) {
        keyboard.push([
            { text: `⬆ ${labels[code]}`, callback_data: `move_service_${code}_up` },
            { text: `⬇ ${labels[code]}`, callback_data: `move_service_${code}_down` }
        ]);
    }

    const perRow = Number.isFinite(config.buttons_per_row) ? Math.max(1, Math.min(3, config.buttons_per_row)) : 1;
    keyboard.push([
        { text: `1 par ligne ${perRow === 1 ? '✅' : ''}`, callback_data: 'set_per_row_1' },
        { text: `2 par ligne ${perRow === 2 ? '✅' : ''}`, callback_data: 'set_per_row_2' },
        { text: `3 par ligne ${perRow === 3 ? '✅' : ''}`, callback_data: 'set_per_row_3' }
    ]);

    keyboard.push([{ text: '🔙 Retour', callback_data: 'admin_back' }]);

    const text = '🧩 <b>Ordonner les services</b>\n\n' +
                 'Utilisez ⬆/⬇ pour déplacer chaque service.\n' +
                 'Choisissez 1–3 par ligne pour régler le nombre de boutons par rangée.\n\n' +
                 '<i>Les changements s\'appliquent au menu /start.</i>';

    await sendOrEditMessage(chatId, text, keyboard, 'HTML', messageId);
}

// Gérer les autres callbacks
async function handleOtherCallbacks(query) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const messageId = query.message.message_id;
    const data = query.data;
    const state = userStates.get(userId) || {};
    
    // Callbacks pour l'édition des textes des services
    if (data.startsWith('edit_text_')) {
        const serviceType = data.replace('edit_text_', '');
        userStates.set(userId, { ...state, state: `waiting_service_text_${serviceType}` });
        await sendOrEditMessage(
            chatId,
            '📝 <b>Envoyez le nouveau texte pour ce service:</b>\n\n' +
            '💡 <i>Astuce: Sélectionnez votre texte et utilisez le menu de formatage Telegram (gras, italique, souligné, etc.)</i>',
            [[{ text: '❌ Annuler', callback_data: `edit_service_${serviceType}` }]],
            'HTML',
            messageId
        );
    }
    
    // Callbacks pour l'édition des photos des services
    else if (data.startsWith('edit_photo_')) {
        const serviceType = data.replace('edit_photo_', '');
        userStates.set(userId, { ...state, state: `waiting_service_photo_${serviceType}` });
        await sendOrEditMessage(
            chatId,
            '🖼️ Envoyez la nouvelle photo pour ce service:',
            [[{ text: '❌ Annuler', callback_data: `edit_service_${serviceType}` }]],
            'HTML',
            messageId
        );
    }
    
    // Callbacks pour la gestion des sous-menus
    else if (data.startsWith('manage_submenus_')) {
        const serviceType = data.replace('manage_submenus_', '');
        await showSubmenuManagement(chatId, userId, serviceType, messageId);
    }
    
    // Callbacks pour les sous-menus
    else if (data.startsWith('submenu_')) {
        const parts = data.split('_');
        const serviceType = parts[1];
        const submenuId = parts[2];
        await showSubmenuContent(chatId, userId, submenuId, messageId);
    }
    
    // Callbacks pour l'édition des réseaux sociaux
    else if (data.startsWith('edit_social_') && !data.includes('_name_') && !data.includes('_emoji_') && !data.includes('_url_')) {
        const socialId = data.replace('edit_social_', '');
        await showSocialEditMenu(chatId, userId, socialId, messageId);
    }
    
    // Ajouter un réseau social
    else if (data === 'add_social') {
        userStates.set(userId, { ...state, state: 'adding_social_name' });
        await sendOrEditMessage(
            chatId,
            '➕ <b>Ajouter un réseau social</b>\n\n' +
            'Envoyez le nom du réseau (ex: Instagram):',
            [[{ text: '❌ Annuler', callback_data: 'admin_social' }]],
            'HTML',
            state.messageId
        );
    }
    
    // Mini app URL
    else if (data === 'edit_miniapp_url') {
        userStates.set(userId, { ...state, state: 'waiting_miniapp_url' });
        await sendOrEditMessage(
            chatId,
            '🔗 Envoyez la nouvelle URL de la mini application:',
            [[{ text: '❌ Annuler', callback_data: 'admin_miniapp' }]],
            'HTML',
            state.messageId
        );
    }
    
    // Menu visibilité services /start
    else if (data === 'admin_services_visibility') {
        const config = await db.getConfig();
        let enabled = ['liv','pos','meet','contact'];
        try {
            if (config.enabled_services) {
                const parsed = JSON.parse(config.enabled_services);
                if (Array.isArray(parsed)) enabled = parsed.filter(c => ['liv','pos','meet','contact'].includes(c));
            }
        } catch (e) {}
        const defs = [
            { code: 'liv', label: '🚚 LIVRAISON' },
            { code: 'pos', label: '📮 POSTAL' },
            { code: 'meet', label: '📍 MEET UP' },
            { code: 'contact', label: '📞 CONTACT' }
        ];
        const keyboard = defs.map(d => [{
            text: `${d.label} — ${enabled.includes(d.code) ? '✅ ON' : '❌ OFF'}`,
            callback_data: `toggle_service_${d.code}`
        }]);
        keyboard.push([{ text: '🔙 Retour', callback_data: 'admin_back' }]);
        const text = '👁️ <b>Créer/Supprimer services du menu /start</b>\n\n' +
            'Cliquez pour activer/désactiver l\'affichage des services dans /start.';
        await sendOrEditMessage(chatId, text, keyboard, 'HTML', state.messageId);
    }

    // Ordonner les services (manuel)
    else if (data === 'admin_arrange') {
        await showArrangeServicesMenu(chatId, userId, state.messageId);
    }

    // Déplacer service haut/bas
    else if (data.startsWith('move_service_')) {
        const rest = data.replace('move_service_', '');
        const parts = rest.split('_');
        const code = parts[0];
        const dir = parts[1];
        if (['liv','pos','meet','contact'].includes(code) && (dir === 'up' || dir === 'down')) {
            const config = await db.getConfig();
            let enabled = ['liv','pos','meet','contact'];
            try {
                if (config.enabled_services) {
                    const parsed = JSON.parse(config.enabled_services);
                    if (Array.isArray(parsed)) enabled = parsed.filter(c => ['liv','pos','meet','contact'].includes(c));
                }
            } catch (e) {}
            const idx = enabled.indexOf(code);
            if (idx !== -1) {
                const newIdx = dir === 'up' ? Math.max(0, idx - 1) : Math.min(enabled.length - 1, idx + 1);
                if (newIdx !== idx) {
                    enabled.splice(idx, 1);
                    enabled.splice(newIdx, 0, code);
                    await db.updateConfig({ enabled_services: JSON.stringify(enabled) });
                }
            }
            await showArrangeServicesMenu(chatId, userId, state.messageId);
        }
    }

    // Régler le nombre par ligne (1–3)
    else if (data.startsWith('set_per_row_')) {
        const n = parseInt(data.replace('set_per_row_', ''), 10);
        const safe = Math.max(1, Math.min(3, Number.isFinite(n) ? n : 1));
        await db.updateConfig({ buttons_per_row: safe });
        await showArrangeServicesMenu(chatId, userId, state.messageId);
    }

    // Boutons personnalisés — menu
    else if (data === 'admin_custom_buttons') {
        const config = await db.getConfig();
        let arr = [];
        try { arr = config.custom_buttons_json ? JSON.parse(config.custom_buttons_json) : []; } catch (e) { arr = []; }
        const keyboard = [];
        for (let i = 0; i < arr.length; i++) {
            const cb = arr[i];
            const status = cb.is_active === false ? '❌ OFF' : '✅ ON';
            keyboard.push([{ text: `${cb.label} (${cb.type}) — ${status}`, callback_data: `custom_btn_toggle_${i}` }]);
            keyboard.push([{ text: `🗑️ Supprimer ${cb.label}`, callback_data: `custom_btn_delete_${i}` }]);
        }
        keyboard.push([{ text: '➕ Ajouter', callback_data: 'custom_btn_add' }]);
        keyboard.push([{ text: '🔙 Retour', callback_data: 'admin_back' }]);
        await sendOrEditMessage(chatId, '🔘 <b>Boutons personnalisés</b>\n\nCréez des boutons avec type (Message, URL, WebApp).', keyboard, 'HTML', state.messageId);
    }

    // Boutons personnalisés — ajouter
    else if (data === 'custom_btn_add') {
        userStates.set(userId, { ...state, state: 'custom_btn_waiting_type' });
        await sendOrEditMessage(
            chatId,
            'Sélectionnez le type de bouton:',
            [
                [{ text: '📝 Message', callback_data: 'custom_btn_pick_type_message' }],
                [{ text: '🔗 URL', callback_data: 'custom_btn_pick_type_url' }],
                [{ text: '🎮 WebApp', callback_data: 'custom_btn_pick_type_web_app' }],
                [{ text: '❌ Annuler', callback_data: 'admin_custom_buttons' }]
            ],
            'HTML',
            state.messageId
        );
    }

    // Boutons personnalisés — choisir type
    else if (data.startsWith('custom_btn_pick_type_')) {
        const type = data.replace('custom_btn_pick_type_', '');
        userStates.set(userId, { ...state, state: 'custom_btn_waiting_label', tmpBtnType: type });
        await sendOrEditMessage(
            chatId,
            '✏️ Envoyez le nom du bouton:',
            [[{ text: '❌ Annuler', callback_data: 'admin_custom_buttons' }]],
            'HTML',
            state.messageId
        );
    }

    // Boutons personnalisés — basculer activation
    else if (data.startsWith('custom_btn_toggle_')) {
        const idx = parseInt(data.replace('custom_btn_toggle_', ''), 10);
        const config = await db.getConfig();
        let arr = [];
        try { arr = config.custom_buttons_json ? JSON.parse(config.custom_buttons_json) : []; } catch (e) { arr = []; }
        if (Array.isArray(arr) && arr[idx]) {
            arr[idx].is_active = arr[idx].is_active === false ? true : false;
            await db.updateConfig({ custom_buttons_json: JSON.stringify(arr) });
        }
        const keyboard = [];
        for (let i = 0; i < arr.length; i++) {
            const cb = arr[i];
            const status = cb.is_active === false ? '❌ OFF' : '✅ ON';
            keyboard.push([{ text: `${cb.label} (${cb.type}) — ${status}`, callback_data: `custom_btn_toggle_${i}` }]);
            keyboard.push([{ text: `🗑️ Supprimer ${cb.label}`, callback_data: `custom_btn_delete_${i}` }]);
        }
        keyboard.push([{ text: '➕ Ajouter', callback_data: 'custom_btn_add' }]);
        keyboard.push([{ text: '🔙 Retour', callback_data: 'admin_back' }]);
        await sendOrEditMessage(chatId, '🔘 <b>Boutons personnalisés</b>\n\nCréez des boutons avec type (Message, URL, WebApp).', keyboard, 'HTML', state.messageId);
    }

    // Boutons personnalisés — supprimer
    else if (data.startsWith('custom_btn_delete_')) {
        const idx = parseInt(data.replace('custom_btn_delete_', ''), 10);
        const config = await db.getConfig();
        let arr = [];
        try { arr = config.custom_buttons_json ? JSON.parse(config.custom_buttons_json) : []; } catch (e) { arr = []; }
        if (Array.isArray(arr) && idx >= 0 && idx < arr.length) {
            arr.splice(idx, 1);
            await db.updateConfig({ custom_buttons_json: JSON.stringify(arr) });
        }
        const keyboard = [];
        for (let i = 0; i < arr.length; i++) {
            const cb = arr[i];
            const status = cb.is_active === false ? '❌ OFF' : '✅ ON';
            keyboard.push([{ text: `${cb.label} (${cb.type}) — ${status}`, callback_data: `custom_btn_toggle_${i}` }]);
            keyboard.push([{ text: `🗑️ Supprimer ${cb.label}`, callback_data: `custom_btn_delete_${i}` }]);
        }
        keyboard.push([{ text: '➕ Ajouter', callback_data: 'custom_btn_add' }]);
        keyboard.push([{ text: '🔙 Retour', callback_data: 'admin_back' }]);
        await sendOrEditMessage(chatId, '✅ Bouton supprimé.', keyboard, 'HTML', state.messageId);
    }

    // Bouton personnalisé — afficher message (utilisateur)
    else if (data.startsWith('custombtn_msg_')) {
        const idx = parseInt(data.replace('custombtn_msg_', ''), 10);
        const config = await db.getConfig();
        let arr = [];
        try { arr = config.custom_buttons_json ? JSON.parse(config.custom_buttons_json) : []; } catch (e) { arr = []; }
        const item = Array.isArray(arr) ? arr[idx] : null;
        if (item && item.type === 'message' && item.is_active !== false) {
            const keyboard = [[{ text: '🔙 Retour', callback_data: 'back_to_start' }]];
            const text = item.value || 'ℹ️ Contenu indisponible.';
            await sendOrEditMessage(chatId, text, keyboard, 'HTML', state.messageId);
        } else {
            await sendOrEditMessage(
                chatId,
                '❌ Ce bouton n\'est pas disponible.',
                [[{ text: '🔙 Retour', callback_data: 'back_to_start' }]],
                'HTML',
                state.messageId
            );
        }
    }
    
    // Basculer activation d'un service dans /start
    else if (data.startsWith('toggle_service_')) {
        const code = data.replace('toggle_service_', '');
        if (['liv','pos','meet','contact'].includes(code)) {
            const config = await db.getConfig();
            let enabled = ['liv','pos','meet','contact'];
            try {
                if (config.enabled_services) {
                    const parsed = JSON.parse(config.enabled_services);
                    if (Array.isArray(parsed)) enabled = parsed.filter(c => ['liv','pos','meet','contact'].includes(c));
                }
            } catch (e) {}
            if (enabled.includes(code)) {
                enabled = enabled.filter(c => c !== code);
            } else {
                enabled.push(code);
            }
            await db.updateConfig({ enabled_services: JSON.stringify(enabled) });

            // Re-render menu de visibilité
            const defs = [
                { code: 'liv', label: '🚚 LIVRAISON' },
                { code: 'pos', label: '📮 POSTAL' },
                { code: 'meet', label: '📍 MEET UP' },
                { code: 'contact', label: '📞 CONTACT' }
            ];
            const keyboard = defs.map(d => [{
                text: `${d.label} — ${enabled.includes(d.code) ? '✅ ON' : '❌ OFF'}`,
                callback_data: `toggle_service_${d.code}`
            }]);
            keyboard.push([{ text: '🔙 Retour', callback_data: 'admin_back' }]);

            const text = '👁️ <b>Créer/Supprimer services du menu /start</b>\n\n' +
                'Cliquez pour activer/désactiver l\'affichage des services dans /start.';
            await sendOrEditMessage(chatId, text, keyboard, 'HTML', state.messageId);
        }
    }
    
    // Mini app texte
    else if (data === 'edit_miniapp_text') {
        userStates.set(userId, { ...state, state: 'waiting_miniapp_text' });
        await sendOrEditMessage(
            chatId,
            '✏️ Envoyez le nouveau texte du bouton:',
            [[{ text: '❌ Annuler', callback_data: 'admin_miniapp' }]],
            'HTML',
            state.messageId
        );
    }
    
    // Callbacks pour l'ajout de photo au sous-menu - DOIT ÊTRE AVANT add_submenu_
    else if (data === 'add_submenu_photo_yes') {
        // Vérifier que les données nécessaires sont présentes
        if (!state.submenuName || !state.submenuText || !state.serviceType) {
            await sendOrEditMessage(
                chatId,
                '❌ Erreur: données du sous-menu perdues. Veuillez recommencer.',
                [[{ text: '🔙 Retour', callback_data: 'admin_services' }]],
                'HTML',
                messageId
            );
            return;
        }
        
        userStates.set(userId, { ...state, state: 'adding_submenu_photo' });
        await sendOrEditMessage(
            chatId,
            '📷 <b>Envoyez la photo pour ce sous-menu</b>\n\n' +
            '<i>Cette photo s\'affichera quand l\'utilisateur cliquera sur le sous-menu</i>',
            [[{ text: '❌ Annuler', callback_data: `manage_submenus_${state.serviceType}` }]],
            'HTML',
            messageId
        );
    }
    
    else if (data === 'add_submenu_photo_no') {
        // Vérifier que les données nécessaires sont présentes
        if (!state.submenuName || !state.submenuText || !state.serviceType) {
            await sendOrEditMessage(
                chatId,
                '❌ Erreur: données du sous-menu perdues. Veuillez recommencer.',
                [[{ text: '🔙 Retour', callback_data: 'admin_services' }]],
                'HTML',
                messageId
            );
            return;
        }
        
        // Créer le sous-menu sans photo
        const fullServiceType = state.serviceType === 'liv' ? 'livraison' : 
                               state.serviceType === 'pos' ? 'postal' : 'meetup';
        
        await db.addSubmenu(fullServiceType, state.submenuName, state.submenuText, null);
        
        await sendOrEditMessage(
            chatId,
            '✅ Sous-menu ajouté sans photo !',
            [[{ text: '🔙 Retour', callback_data: 'admin_services' }]],
            'HTML',
            messageId
        );
        
        // Nettoyer l'état
        userStates.set(userId, { messageId: messageId });
    }
    
    // Ajouter un sous-menu
    else if (data.startsWith('add_submenu_')) {
        const serviceType = data.replace('add_submenu_', '');
        userStates.set(userId, { ...state, state: 'adding_submenu_name', serviceType });
        await sendOrEditMessage(
            chatId,
            '➕ <b>Ajouter un sous-menu</b>\n\n' +
            'Envoyez le nom du sous-menu:',
            [[{ text: '❌ Annuler', callback_data: `manage_submenus_${serviceType}` }]],
            'HTML',
            messageId
        );
    }
    
    // Éditer un sous-menu
    else if (data.startsWith('edit_submenu_') && !data.includes('_name_') && !data.includes('_text_') && !data.includes('_photo_')) {
        // Extraire submenuId en prenant la dernière partie après le dernier underscore
        const lastUnderscoreIndex = data.lastIndexOf('_');
        const submenuId = data.substring(lastUnderscoreIndex + 1);
        // Extraire serviceType en enlevant le préfixe et le suffixe
        const prefix = 'edit_submenu_';
        const serviceType = data.substring(prefix.length, lastUnderscoreIndex);
        await showSubmenuEditMenu(chatId, userId, serviceType, submenuId, messageId);
    }
    
    // Supprimer un sous-menu
    else if (data.startsWith('delete_submenu_')) {
        const submenuId = data.replace('delete_submenu_', '');
        await db.deleteSubmenu(submenuId);
        await sendOrEditMessage(
            chatId,
            '✅ Sous-menu supprimé !',
            [[{ text: '🔙 Retour', callback_data: 'admin_services' }]],
            'HTML',
            messageId
        );
    }
    
    // Modifier nom réseau social
    else if (data.startsWith('edit_social_name_')) {
        const socialId = data.replace('edit_social_name_', '');
        userStates.set(userId, { ...state, state: 'editing_social_name', socialId });
        await sendOrEditMessage(
            chatId,
            '✏️ Envoyez le nouveau nom:',
            [[{ text: '❌ Annuler', callback_data: `edit_social_${socialId}` }]],
            'HTML',
            messageId
        );
    }
    
    // Modifier emoji réseau social
    else if (data.startsWith('edit_social_emoji_')) {
        const socialId = data.replace('edit_social_emoji_', '');
        userStates.set(userId, { ...state, state: 'editing_social_emoji', socialId });
        await sendOrEditMessage(
            chatId,
            '😀 Envoyez le nouvel emoji:',
            [[{ text: '❌ Annuler', callback_data: `edit_social_${socialId}` }]],
            'HTML',
            messageId
        );
    }
    
    // Modifier URL réseau social
    else if (data.startsWith('edit_social_url_')) {
        const socialId = data.replace('edit_social_url_', '');
        userStates.set(userId, { ...state, state: 'editing_social_url', socialId });
        await sendOrEditMessage(
            chatId,
            '🔗 Envoyez la nouvelle URL:',
            [[{ text: '❌ Annuler', callback_data: `edit_social_${socialId}` }]],
            'HTML',
            messageId
        );
    }
    
    // Supprimer réseau social
    else if (data.startsWith('delete_social_')) {
        const socialId = data.replace('delete_social_', '');
        await db.deleteSocialNetwork(socialId);
        await sendOrEditMessage(
            chatId,
            '✅ Réseau social supprimé !',
            [[{ text: '🔙 Retour', callback_data: 'admin_social' }]],
            'HTML',
            messageId
        );
    }

    // Raccourcis: choisir action
    else if (data.startsWith('shortcut_pick_action_')) {
        if (!(await isAdmin(userId))) return;
        const action = data.replace('shortcut_pick_action_', '');
        userStates.set(userId, { ...state, state: 'shortcut_waiting_label', tmpShortcutAction: action });
        await sendOrEditMessage(
            chatId,
            '✏️ Envoyez le nom du bouton pour ce raccourci:',
            [[{ text: '❌ Annuler', callback_data: 'admin_shortcuts' }]],
            'HTML',
            messageId
        );
    }

    // Raccourcis: exécuter
    else if (data.startsWith('shortcut_run_')) {
        if (!(await isAdmin(userId))) return;
        const idx = parseInt(data.replace('shortcut_run_', ''), 10);
        const shortcuts = state.shortcuts || [];
        const sc = shortcuts[idx];
        if (!sc) {
            await sendOrEditMessage(chatId, '❌ Raccourci introuvable.', [[{ text: '🔙 Retour', callback_data: 'admin_shortcuts' }]], 'HTML', messageId);
        } else {
            const action = sc.action;
            if (action === 'admin_open_bot_panel') {
                await showAdminMenu(chatId, userId, messageId);
            } else if (action === 'admin_stats') {
                const stats = await db.getDetailedStats();
                await sendOrEditMessage(
                    chatId,
                    `📊 <b>Statistiques détaillées</b>\n\n` +
                    `👥 Total utilisateurs: ${stats.totalUsers}\n` +
                    `🚀 Démarrages: ${stats.totalStarts}\n` +
                    `👨‍💼 Administrateurs: ${stats.totalAdmins}\n` +
                    `📅 Utilisateurs aujourd'hui: ${stats.todayUsers}\n` +
                    `📈 Utilisateurs cette semaine: ${stats.weekUsers}`,
                    [[{ text: '🔙 Retour', callback_data: 'admin_back' }]],
                    'HTML',
                    messageId
                );
            } else if (action === 'admin_manage') {
                await showAdminManagement(chatId, userId, messageId);
            } else if (action === 'admin_broadcast') {
                userStates.set(userId, { ...state, state: 'waiting_broadcast' });
                await sendOrEditMessage(
                    chatId,
                    '📢 <b>Envoyer un message à tous</b>\n\n' +
                    'Envoyez le message que vous voulez diffuser à tous les utilisateurs.',
                    [[{ text: '❌ Annuler', callback_data: 'admin_back' }]],
                    'HTML',
                    messageId
                );
            } else if (action === 'admin_services') {
                await sendOrEditMessage(
                    chatId,
                    '🚚 <b>Gérer les Services</b>\n\n' +
                    'Sélectionnez un service à configurer:',
                    [
                        [{ text: '🚚 LIVRAISON', callback_data: 'edit_service_liv' }],
                        [{ text: '📮 POSTAL', callback_data: 'edit_service_pos' }],
                        [{ text: '📍 MEET UP', callback_data: 'edit_service_meet' }],
                        [{ text: '🔙 Retour', callback_data: 'admin_back' }]
                    ],
                    'HTML',
                    messageId
                );
            } else if (action === 'admin_miniapp') {
                const config = await db.getConfig();
                await sendOrEditMessage(
                    chatId,
                    '📱 <b>Mini Application</b>\n\n' +
                    `URL actuelle: ${config.mini_app_url || 'Non définie'}\n` +
                    `Texte du bouton: ${config.mini_app_text || '🎮 Ouvrir l\'application'}`,
                    [
                        [{ text: '🔗 Modifier URL', callback_data: 'edit_miniapp_url' }],
                        [{ text: '✏️ Modifier Texte', callback_data: 'edit_miniapp_text' }],
                        [{ text: '🔙 Retour', callback_data: 'admin_back' }]
                    ],
                    'HTML',
                    messageId
                );
            } else if (action === 'admin_social') {
                await showSocialMenu(chatId, userId, messageId);
            } else if (action === 'admin_welcome') {
                userStates.set(userId, { ...state, state: 'waiting_welcome' });
                await sendOrEditMessage(
                    chatId,
                    '✏️ <b>Modifier le message d\'accueil</b>\n\n' +
                    'Envoyez le nouveau message.\n' +
                    'Utilisez {firstname} pour inclure le prénom.\n\n' +
                    '💡 <i>Astuce: Sélectionnez votre texte et utilisez le menu de formatage Telegram</i>',
                    [[{ text: '❌ Annuler', callback_data: 'admin_back' }]],
                    'HTML',
                    messageId
                );
            } else if (action === 'admin_photo') {
                userStates.set(userId, { ...state, state: 'waiting_photo' });
                await sendOrEditMessage(
                    chatId,
                    '🖼️ <b>Modifier la photo d\'accueil</b>\n\n' +
                    'Envoyez la nouvelle photo.',
                    [[{ text: '❌ Annuler', callback_data: 'admin_back' }]],
                    'HTML',
                    messageId
                );
            } else if (action === 'admin_commands_list') {
                const text = getAdminCommandsText();
                const keyboard = [
                    [{ text: '🤖 Panel Bot Telegram', callback_data: 'admin_open_bot_panel' }],
                    [{ text: '🔙 Portail', callback_data: 'admin_root' }]
                ];
                await sendOrEditMessage(chatId, text, keyboard, 'HTML', messageId);
            } else if (action.startsWith('admin_clear_')) {
                const parts = action.split('_');
                const n = parseInt(parts[2], 10);
                const deleted = await clearLastBotMessages(chatId, Number.isFinite(n) ? n : 5);
                const keyboard = [
                    [{ text: '🔙 Retour', callback_data: 'admin_shortcuts' }],
                    [{ text: '🔙 Portail', callback_data: 'admin_root' }]
                ];
                await sendOrEditMessage(chatId, `🧹 <b>Clear</b>\n\n${deleted} message(s) du bot supprimé(s).`, keyboard, 'HTML', null);
            }
        }
    }

    // Raccourcis: supprimer
    else if (data.startsWith('shortcut_delete_')) {
        if (!(await isAdmin(userId))) return;
        const idx = parseInt(data.replace('shortcut_delete_', ''), 10);
        const shortcuts = state.shortcuts || [];
        if (Number.isInteger(idx) && idx >= 0 && idx < shortcuts.length) {
            shortcuts.splice(idx, 1);
        }
        userStates.set(userId, { ...state, shortcuts });
        await sendOrEditMessage(
            chatId,
            '✅ Raccourci supprimé.',
            [[{ text: '🔙 Retour', callback_data: 'admin_shortcuts' }]],
            'HTML',
            messageId
        );
    }
    
    // Ajouter un admin
    else if (data === 'add_admin') {
        userStates.set(userId, { ...state, state: 'adding_admin' });
        await sendOrEditMessage(
            chatId,
            '➕ <b>Ajouter un administrateur</b>\n\n' +
            'Envoyez l\'ID Telegram ou le @username de l\'utilisateur:',
            [[{ text: '❌ Annuler', callback_data: 'admin_manage' }]],
            'HTML',
            messageId
        );
    }
    
    // Retirer un admin
    else if (data === 'remove_admin') {
        const admins = await db.getAdmins();
        const keyboard = [];
        
        for (const admin of admins) {
            if (admin.user_id.toString() !== process.env.ADMIN_ID) {
                keyboard.push([{ 
                    text: `❌ ${admin.first_name || 'Admin'} (@${admin.username || admin.user_id})`, 
                    callback_data: `confirm_remove_admin_${admin.user_id}` 
                }]);
            }
        }
        
        keyboard.push([{ text: '🔙 Retour', callback_data: 'admin_manage' }]);
        
        await sendOrEditMessage(
            chatId,
            '❌ <b>Retirer un administrateur</b>\n\n' +
            'Sélectionnez l\'admin à retirer:',
            keyboard,
            'HTML',
            messageId
        );
    }
    
    // Confirmer suppression admin
    else if (data.startsWith('confirm_remove_admin_')) {
        const adminId = parseInt(data.replace('confirm_remove_admin_', ''));
        await db.setAdmin(adminId, false);
        
        // Rafraîchir l'affichage des administrateurs
        await showAdminManagement(chatId, userId, messageId);
    }
    
    // Modifier nom d'un sous-menu
    else if (data.startsWith('edit_submenu_name_')) {
        // Extraire submenuId en prenant la dernière partie après le dernier underscore
        const lastUnderscoreIndex = data.lastIndexOf('_');
        const submenuId = data.substring(lastUnderscoreIndex + 1);
        // Extraire serviceType en enlevant le préfixe et le suffixe
        const prefix = 'edit_submenu_name_';
        const serviceType = data.substring(prefix.length, lastUnderscoreIndex);
        userStates.set(userId, { ...state, state: 'editing_submenu_name', submenuId, serviceType });
        await sendOrEditMessage(
            chatId,
            '✏️ Envoyez le nouveau nom du sous-menu:',
            [[{ text: '❌ Annuler', callback_data: `edit_submenu_${serviceType}_${submenuId}` }]],
            'HTML',
            messageId
        );
    }
    
    // Modifier texte d'un sous-menu
    else if (data.startsWith('edit_submenu_text_')) {
        // Extraire submenuId en prenant la dernière partie après le dernier underscore
        const lastUnderscoreIndex = data.lastIndexOf('_');
        const submenuId = data.substring(lastUnderscoreIndex + 1);
        // Extraire serviceType en enlevant le préfixe et le suffixe
        const prefix = 'edit_submenu_text_';
        const serviceType = data.substring(prefix.length, lastUnderscoreIndex);
        userStates.set(userId, { ...state, state: 'editing_submenu_text', submenuId, serviceType });
        await sendOrEditMessage(
            chatId,
            '📝 <b>Envoyez le nouveau texte du sous-menu:</b>\n\n' +
            '💡 <i>Astuce: Sélectionnez votre texte et utilisez le menu de formatage Telegram</i>',
            [[{ text: '❌ Annuler', callback_data: `edit_submenu_${serviceType}_${submenuId}` }]],
            'HTML',
            messageId
        );
    }
    
    // Modifier photo d'un sous-menu
    else if (data.startsWith('edit_submenu_photo_')) {
        // Extraire submenuId en prenant la dernière partie après le dernier underscore
        const lastUnderscoreIndex = data.lastIndexOf('_');
        const submenuId = data.substring(lastUnderscoreIndex + 1);
        // Extraire serviceType en enlevant le préfixe et le suffixe
        const prefix = 'edit_submenu_photo_';
        const serviceType = data.substring(prefix.length, lastUnderscoreIndex);
        userStates.set(userId, { ...state, state: 'editing_submenu_photo', submenuId, serviceType });
        await sendOrEditMessage(
            chatId,
            '🖼️ Envoyez la nouvelle photo du sous-menu:',
            [[{ text: '❌ Annuler', callback_data: `edit_submenu_${serviceType}_${submenuId}` }]],
            'HTML',
            messageId
        );
    }
}

// Gestion des messages texte
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const messageId = msg.message_id;

    // Supprimer les messages des utilisateurs après 5 secondes
    try {
        setTimeout(async () => {
            try { await bot.deleteMessage(chatId, messageId); } catch (e) {}
        }, 5000);
    } catch (e) {}

    if (msg.text && (msg.text.startsWith('/start') || msg.text.startsWith('/admin'))) {
        return; // Ignorer les commandes
    }
    
    const state = userStates.get(userId) || {};
    
    if (!state.state) return;
    
    // Gestion du message d'accueil
    if (state.state === 'waiting_welcome') {
        // Convertir les entités Telegram en HTML
        const formattedText = parseMessageEntities(msg.text, msg.entities);
        await db.updateConfig({ welcome_message: formattedText });
        delete state.state;
        await sendOrEditMessage(
            chatId,
            '✅ Message d\'accueil mis à jour !',
            [[{ text: '🔙 Retour', callback_data: 'admin_back' }]],
            'HTML',
            state.messageId
        );
    }
    
    // Gestion de la disposition des boutons
    else if (state.state === 'waiting_layout_input') {
        const raw = (msg.text || '').trim();
        const parts = raw.split(',').map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n) && n > 0);
        const valid = parts.map(n => Math.max(1, Math.min(3, n)));
        if (valid.length === 0) {
            await sendOrEditMessage(
                chatId,
                '❌ Format invalide. Exemple correct: 2,1',
                [[{ text: '🔙 Retour', callback_data: 'admin_back' }]],
                'HTML',
                state.messageId
            );
        } else {
            await db.updateConfig({ buttons_layout: JSON.stringify(valid) });
            delete state.state;
            await sendOrEditMessage(
                chatId,
                `✅ Disposition mise à jour: ${valid.join(', ')}`,
                [[{ text: '🔙 Retour', callback_data: 'admin_back' }]],
                'HTML',
                state.messageId
            );
        }
    }
    
    // Gestion du broadcast
    else if (state.state === 'waiting_broadcast') {
        const users = await db.getAllUsers();
        let sent = 0;
        
        // Convertir les entités Telegram en HTML
        const formattedText = parseMessageEntities(msg.text, msg.entities);
        
        for (const user of users) {
            try {
                await bot.sendMessage(user.user_id, formattedText, { parse_mode: 'HTML' });
                sent++;
            } catch (error) {
                console.log(`Erreur envoi à ${user.user_id}:`, error.message);
            }
        }
        
        delete state.state;
        await sendOrEditMessage(
            chatId,
            `✅ Message envoyé à ${sent}/${users.length} utilisateurs !`,
            [[{ text: '🔙 Retour', callback_data: 'admin_back' }]],
            'HTML',
            state.messageId
        );
    }

    // Gestion du message de contact
    else if (state.state === 'waiting_contact_message') {
        if (!ADMIN_CHAT_ID) {
            delete state.state;
            await sendOrEditMessage(
                chatId,
                '❌ Le contact n\'est pas disponible pour le moment. Merci de réessayer plus tard.',
                [[{ text: '🔙 Retour', callback_data: 'back_to_start' }]],
                'HTML',
                state.messageId
            );
        } else {
            const from = msg.from || {};
            const username = from.username ? `@${from.username}` : '—';
            const fullName = `${from.first_name || ''} ${from.last_name || ''}`.trim() || 'Utilisateur';
            const header = `📩 Nouveau message de contact\n👤 ${fullName} (${username})\n🆔 ID: ${from.id}\n🔗 Chat: ${msg.chat.type}`;
            try {
                await bot.sendMessage(ADMIN_CHAT_ID, header, { parse_mode: 'HTML' });
                await bot.forwardMessage(ADMIN_CHAT_ID, chatId, msg.message_id);
                delete state.state;
                await sendOrEditMessage(
                    chatId,
                    '✅ Merci ! Votre message a été envoyé. Notre équipe vous répondra bientôt.',
                    [[{ text: '🔙 Retour', callback_data: 'back_to_start' }]],
                    'HTML',
                    state.messageId
                );
            } catch (err) {
                delete state.state;
                await sendOrEditMessage(
                    chatId,
                    '❌ Désolé, une erreur est survenue lors de l\'envoi du message. Réessayez plus tard.',
                    [[{ text: '🔙 Retour', callback_data: 'back_to_start' }]],
                    'HTML',
                    state.messageId
                );
            }
        }
    }

    // Boutons personnalisés — attendre nom
    else if (state.state === 'custom_btn_waiting_label') {
        const label = (msg.text || '').trim();
        if (!label) {
            await sendOrEditMessage(
                chatId,
                '❌ Le nom du bouton ne peut pas être vide. Envoyez un nom.',
                [[{ text: '❌ Annuler', callback_data: 'admin_custom_buttons' }]],
                'HTML',
                state.messageId
            );
        } else {
            state.tmpBtnLabel = label;
            state.state = 'custom_btn_waiting_value';
            userStates.set(userId, state);
            const type = state.tmpBtnType;
            if (type === 'message') {
                await sendOrEditMessage(
                    chatId,
                    '📝 Envoyez le contenu du message (HTML autorisé).',
                    [[{ text: '❌ Annuler', callback_data: 'admin_custom_buttons' }]],
                    'HTML',
                    state.messageId
                );
            } else if (type === 'url') {
                await sendOrEditMessage(
                    chatId,
                    '🔗 Envoyez l\'URL du bouton.',
                    [[{ text: '❌ Annuler', callback_data: 'admin_custom_buttons' }]],
                    'HTML',
                    state.messageId
                );
            } else if (type === 'web_app') {
                await sendOrEditMessage(
                    chatId,
                    '🎮 Envoyez l\'URL de la WebApp (HTTPS, même domaine que le bot).',
                    [[{ text: '❌ Annuler', callback_data: 'admin_custom_buttons' }]],
                    'HTML',
                    state.messageId
                );
            } else {
                delete state.state; delete state.tmpBtnType; delete state.tmpBtnLabel;
                await sendOrEditMessage(
                    chatId,
                    '❌ Type inconnu. Réessayez.',
                    [[{ text: '🔙 Retour', callback_data: 'admin_back' }]],
                    'HTML',
                    state.messageId
                );
            }
        }
    }

    // Boutons personnalisés — attendre valeur
    else if (state.state === 'custom_btn_waiting_value') {
        const type = state.tmpBtnType;
        const label = state.tmpBtnLabel;
        let valueRaw = (msg.text || '').trim();

        if (type === 'message') {
            const formattedText = parseMessageEntities(msg.text, msg.entities);
            valueRaw = formattedText;
        } else if (type === 'url') {
            if (!/^https?:\/\//i.test(valueRaw)) {
                await sendOrEditMessage(
                    chatId,
                    '❌ URL invalide. Elle doit commencer par http:// ou https://',
                    [[{ text: '❌ Annuler', callback_data: 'admin_custom_buttons' }]],
                    'HTML',
                    state.messageId
                );
                return;
            }
        } else if (type === 'web_app') {
            if (!isValidWebAppUrl(valueRaw)) {
                await sendOrEditMessage(
                    chatId,
                    '❌ URL WebApp invalide. Utilisez une URL HTTPS valide conforme aux exigences Telegram.',
                    [[{ text: '❌ Annuler', callback_data: 'admin_custom_buttons' }]],
                    'HTML',
                    state.messageId
                );
                return;
            }
        } else {
            await sendOrEditMessage(
                chatId,
                '❌ Type inconnu. Réessayez.',
                [[{ text: '🔙 Retour', callback_data: 'admin_back' }]],
                'HTML',
                state.messageId
            );
            return;
        }

        const config = await db.getConfig();
        let arr = [];
        try { arr = config.custom_buttons_json ? JSON.parse(config.custom_buttons_json) : []; } catch (e) { arr = []; }
        if (!Array.isArray(arr)) arr = [];
        arr.push({ type, label, value: valueRaw, is_active: true });
        await db.updateConfig({ custom_buttons_json: JSON.stringify(arr) });

        delete state.state; delete state.tmpBtnType; delete state.tmpBtnLabel;
        userStates.set(userId, state);

        const keyboard = [];
        for (let i = 0; i < arr.length; i++) {
            const cb = arr[i];
            const status = cb.is_active === false ? '❌ OFF' : '✅ ON';
            keyboard.push([{ text: `${cb.label} (${cb.type}) — ${status}`, callback_data: `custom_btn_toggle_${i}` }]);
            keyboard.push([{ text: `🗑️ Supprimer ${cb.label}`, callback_data: `custom_btn_delete_${i}` }]);
        }
        keyboard.push([{ text: '➕ Ajouter', callback_data: 'custom_btn_add' }]);
        keyboard.push([{ text: '🔙 Retour', callback_data: 'admin_back' }]);
        await sendOrEditMessage(chatId, '✅ Bouton personnalisé créé !', keyboard, 'HTML', state.messageId);
    }

    // Gestion de la création de raccourci (nom du bouton)
    else if (state.state === 'shortcut_waiting_label') {
        const label = (msg.text || '').trim();
        const shortcuts = state.shortcuts || [];
        if (label.length === 0) {
            await sendOrEditMessage(
                chatId,
                '❌ Le nom du bouton ne peut pas être vide. Envoyez un nom.',
                [[{ text: '❌ Annuler', callback_data: 'admin_shortcuts' }]],
                'HTML',
                state.messageId
            );
        } else {
            shortcuts.push({ label, action: state.tmpShortcutAction });
            delete state.tmpShortcutAction;
            state.shortcuts = shortcuts;
            delete state.state;
            userStates.set(userId, state);

            const keyboard = [];
            for (let i = 0; i < shortcuts.length; i++) {
                keyboard.push([{ text: `▶ ${shortcuts[i].label}`, callback_data: `shortcut_run_${i}` }]);
            }
            keyboard.push([{ text: '➕ Ajouter', callback_data: 'shortcut_add' }]);
            if (shortcuts.length > 0) {
                keyboard.push([{ text: '🗑️ Supprimer', callback_data: 'shortcut_delete_list' }]);
            }
            keyboard.push([{ text: '🔙 Portail', callback_data: 'admin_root' }]);

            await sendOrEditMessage(
                chatId,
                `✅ Raccourci ajouté: ${label}`,
                keyboard,
                'HTML',
                state.messageId
            );
        }
    }
    
    // Gestion des textes des services
    else if (state.state.startsWith('waiting_service_text_')) {
        const serviceType = state.state.replace('waiting_service_text_', '');
        const field = serviceType === 'liv' ? 'livraison_text' :
                     serviceType === 'pos' ? 'postal_text' : 'meetup_text';
        
        // Convertir les entités Telegram en HTML
        const formattedText = parseMessageEntities(msg.text, msg.entities);
        await db.updateConfig({ [field]: formattedText });
        delete state.state;
        await sendOrEditMessage(
            chatId,
            '✅ Texte du service mis à jour !',
            [[{ text: '🔙 Retour', callback_data: `edit_service_${serviceType}` }]],
            'HTML',
            state.messageId
        );
    }
    
    // Gestion de l'ajout de réseau social
    else if (state.state === 'adding_social_name') {
        state.socialName = msg.text;
        state.state = 'adding_social_emoji';
        userStates.set(userId, state);
        
        await sendOrEditMessage(
            chatId,
            `📱 <b>${msg.text}</b>\n\n` +
            'Envoyez l\'emoji pour ce réseau (ex: 📷):',
            [[{ text: '❌ Annuler', callback_data: 'admin_social' }]],
            'HTML',
            state.messageId
        );
    }
    
    else if (state.state === 'adding_social_emoji') {
        state.socialEmoji = msg.text;
        state.state = 'adding_social_url';
        userStates.set(userId, state);
        
        await sendOrEditMessage(
            chatId,
            `${msg.text} <b>${state.socialName}</b>\n\n` +
            'Envoyez l\'URL du réseau:',
            [[{ text: '❌ Annuler', callback_data: 'admin_social' }]],
            'HTML',
            state.messageId
        );
    }
    
    else if (state.state === 'adding_social_url') {
        await db.addSocialNetwork(state.socialName, state.socialEmoji, msg.text);
        delete state.state;
        delete state.socialName;
        delete state.socialEmoji;
        
        await sendOrEditMessage(
            chatId,
            '✅ Réseau social ajouté !',
            [[{ text: '🔙 Retour', callback_data: 'admin_social' }]],
            'HTML',
            state.messageId
        );
    }
    
    // Gestion mini app
    else if (state.state === 'waiting_miniapp_url') {
        if (isValidWebAppUrl(msg.text)) {
            await db.updateConfig({ mini_app_url: msg.text });
            delete state.state;
            await sendOrEditMessage(
                chatId,
                '✅ URL de la mini application mise à jour !',
                [[{ text: '🔙 Retour', callback_data: 'admin_miniapp' }]],
                'HTML',
                state.messageId
            );
        } else {
            await sendOrEditMessage(
                chatId,
                '❌ URL invalide. Fournissez une URL complète (ex: https://votre-domaine/app).',
                [[{ text: '❌ Annuler', callback_data: 'admin_miniapp' }]],
                'HTML',
                state.messageId
            );
        }
    }
    
    else if (state.state === 'waiting_miniapp_text') {
        await db.updateConfig({ mini_app_text: msg.text });
        delete state.state;
        await sendOrEditMessage(
            chatId,
            '✅ Texte du bouton mis à jour !',
            [[{ text: '🔙 Retour', callback_data: 'admin_miniapp' }]],
            'HTML',
            state.messageId
        );
    }
    
    // Gestion de l'ajout de sous-menu
    else if (state.state === 'adding_submenu_name') {
        state.submenuName = msg.text;
        state.state = 'adding_submenu_text';
        userStates.set(userId, state);
        
        await sendOrEditMessage(
            chatId,
            `📋 <b>${msg.text}</b>\n\n` +
            'Envoyez le texte/description du sous-menu:\n\n' +
            '💡 <i>Astuce: Sélectionnez votre texte et utilisez le menu de formatage Telegram</i>',
            [[{ text: '❌ Annuler', callback_data: `manage_submenus_${state.serviceType}` }]],
            'HTML',
            state.messageId
        );
    }
    
    else if (state.state === 'adding_submenu_text') {
        // Sauvegarder le texte formaté
        const formattedText = parseMessageEntities(msg.text, msg.entities);
        state.submenuText = formattedText;
        // Retirer l'état temporairement pour éviter que le bot pense encore attendre un texte
        delete state.state;
        userStates.set(userId, state);
        
        // Demander si l'utilisateur veut ajouter une photo
        await sendOrEditMessage(
            chatId,
            '🖼️ <b>Voulez-vous ajouter une photo à ce sous-menu ?</b>\n\n' +
            '<i>La photo s\'affichera avec le texte du sous-menu</i>',
            [
                [{ text: '📷 Oui, ajouter une photo', callback_data: 'add_submenu_photo_yes' }],
                [{ text: '❌ Non, pas de photo', callback_data: 'add_submenu_photo_no' }]
            ],
            'HTML',
            state.messageId
        );
    }
    
    
    // Gestion de la modification des réseaux sociaux
    else if (state.state === 'editing_social_name') {
        await db.updateSocialNetwork(state.socialId, { name: msg.text });
        delete state.state;
        delete state.socialId;
        
        await sendOrEditMessage(
            chatId,
            '✅ Nom du réseau social mis à jour !',
            [[{ text: '🔙 Retour', callback_data: 'admin_social' }]],
            'HTML',
            state.messageId
        );
    }
    
    else if (state.state === 'editing_social_emoji') {
        await db.updateSocialNetwork(state.socialId, { emoji: msg.text });
        delete state.state;
        delete state.socialId;
        
        await sendOrEditMessage(
            chatId,
            '✅ Emoji du réseau social mis à jour !',
            [[{ text: '🔙 Retour', callback_data: 'admin_social' }]],
            'HTML',
            state.messageId
        );
    }
    
    else if (state.state === 'editing_social_url') {
        await db.updateSocialNetwork(state.socialId, { url: msg.text });
        delete state.state;
        delete state.socialId;
        
        await sendOrEditMessage(
            chatId,
            '✅ URL du réseau social mise à jour !',
            [[{ text: '🔙 Retour', callback_data: 'admin_social' }]],
            'HTML',
            state.messageId
        );
    }
    
    // Gestion de l'ajout d'admin
    else if (state.state === 'adding_admin') {
        let newAdminId;
        
        // Si c'est un username
        if (msg.text.startsWith('@')) {
            const username = msg.text.substring(1);
            const users = await db.getAllUsers();
            const user = users.find(u => u.username === username);
            
            if (user) {
                newAdminId = user.user_id;
            } else {
                await sendOrEditMessage(
                    chatId,
                    '❌ Utilisateur non trouvé. Il doit d\'abord utiliser le bot.',
                    [[{ text: '🔙 Retour', callback_data: 'admin_manage' }]],
                    'HTML',
                    state.messageId
                );
                delete state.state;
                return;
            }
        } else {
            // C'est un ID
            newAdminId = parseInt(msg.text);
            
            // Vérifier si l'utilisateur existe
            const user = await db.getUser(newAdminId);
            if (!user) {
                // Créer l'utilisateur s'il n'existe pas
                await db.upsertUser(newAdminId, null, 'Nouvel Admin', null);
            }
        }
        
        await db.setAdmin(newAdminId, true);
        delete state.state;
        
        // Rafraîchir l'affichage des administrateurs
        await showAdminManagement(chatId, userId, state.messageId);
    }
    
    // Gestion de la modification des sous-menus
    else if (state.state && state.state.startsWith('editing_submenu_')) {
        const parts = state.state.split('_');
        const field = parts[2]; // name, text, etc.
        const submenuId = state.submenuId;
        
        if (field === 'name') {
            await db.updateSubmenu(submenuId, { name: msg.text });
        } else if (field === 'text') {
            // Convertir les entités Telegram en HTML
            const formattedText = parseMessageEntities(msg.text, msg.entities);
            await db.updateSubmenu(submenuId, { text: formattedText });
        }
        
        delete state.state;
        delete state.submenuId;
        delete state.serviceType;
        
        await sendOrEditMessage(
            chatId,
            '✅ Sous-menu mis à jour !',
            [[{ text: '🔙 Retour', callback_data: 'admin_services' }]],
            'HTML',
            state.messageId
        );
    }
});

// Gestion des photos
bot.on('photo', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const messageId = msg.message_id;
    const state = userStates.get(userId) || {};

    // Supprimer les messages des utilisateurs après 5 secondes
    try {
        setTimeout(async () => {
            try { await bot.deleteMessage(chatId, messageId); } catch (e) {}
        }, 5000);
    } catch (e) {}
    
    if (!state.state) return;
    
    const photo = msg.photo[msg.photo.length - 1].file_id;
    
    // Photo d'accueil
    if (state.state === 'waiting_photo') {
        await db.updateConfig({ welcome_image: photo });
        delete state.state;
        await sendOrEditMessage(
            chatId,
            '✅ Photo d\'accueil mise à jour !',
            [[{ text: '🔙 Retour', callback_data: 'admin_back' }]],
            'HTML',
            state.messageId
        );
    }
    
    // Photos des services
    else if (state.state.startsWith('waiting_service_photo_')) {
        const serviceType = state.state.replace('waiting_service_photo_', '');
        const field = serviceType === 'liv' ? 'livraison_image' :
                     serviceType === 'pos' ? 'postal_image' : 'meetup_image';
        
        await db.updateConfig({ [field]: photo });
        delete state.state;
        await sendOrEditMessage(
            chatId,
            '✅ Photo du service mise à jour !',
            [[{ text: '🔙 Retour', callback_data: `edit_service_${serviceType}` }]],
            'HTML',
            state.messageId
        );
    }
    
    // Photo d'un sous-menu (modification)
    else if (state.state === 'editing_submenu_photo') {
        await db.updateSubmenu(state.submenuId, { image: photo });
        delete state.state;
        delete state.submenuId;
        delete state.serviceType;
        
        await sendOrEditMessage(
            chatId,
            '✅ Photo du sous-menu mise à jour !',
            [[{ text: '🔙 Retour', callback_data: 'admin_services' }]],
            'HTML',
            state.messageId
        );
    }
    
    // Photo d'un sous-menu (création)
    else if (state.state === 'adding_submenu_photo') {
        const fullServiceType = state.serviceType === 'liv' ? 'livraison' : 
                               state.serviceType === 'pos' ? 'postal' : 'meetup';
        
        await db.addSubmenu(fullServiceType, state.submenuName, state.submenuText, photo);
        delete state.state;
        delete state.submenuName;
        delete state.submenuText;
        delete state.serviceType;
        
        await sendOrEditMessage(
            chatId,
            '✅ Sous-menu ajouté avec photo !',
            [[{ text: '🔙 Retour', callback_data: 'admin_services' }]],
            'HTML',
            state.messageId
        );
        
        // Nettoyer l'état
        userStates.set(userId, { messageId: state.messageId });
    }
});

// Gestion des sous-menus
async function showSubmenuManagement(chatId, userId, serviceType, messageId) {
    const fullServiceType = serviceType === 'liv' ? 'livraison' : 
                           serviceType === 'pos' ? 'postal' : 'meetup';
    const submenus = await db.getServiceSubmenus(fullServiceType);
    
    const keyboard = [];
    
    // Afficher les sous-menus existants
    for (const submenu of submenus) {
        keyboard.push([{ 
            text: submenu.name, 
            callback_data: `edit_submenu_${serviceType}_${submenu.id}` 
        }]);
    }
    
    keyboard.push([{ text: '➕ Ajouter un sous-menu', callback_data: `add_submenu_${serviceType}` }]);
    keyboard.push([{ text: '🔙 Retour', callback_data: `edit_service_${serviceType}` }]);
    
    await sendOrEditMessage(
        chatId,
        `📋 <b>Sous-menus du service</b>\n\n` +
        `Cliquez sur un sous-menu pour le modifier.`,
        keyboard,
        'HTML',
        messageId
    );
}

// Afficher le contenu d'un sous-menu
async function showSubmenuContent(chatId, userId, submenuId, messageId) {
    const submenu = await db.getSubmenu(submenuId);
    
    if (!submenu) {
        await sendOrEditMessage(
            chatId,
            '❌ Sous-menu non trouvé',
            [[{ text: '🔙 Retour', callback_data: 'back_to_start' }]],
            'HTML',
            messageId
        );
        return;
    }
    
    // Déterminer le bon callback pour le retour
    let serviceCallback;
    switch(submenu.service_type) {
        case 'livraison':
            serviceCallback = 'service_liv';
            break;
        case 'postal':
            serviceCallback = 'service_pos';
            break;
        case 'meetup':
            serviceCallback = 'service_meet';
            break;
        default:
            serviceCallback = 'back_to_start';
    }
    
    const keyboard = [[{ text: '🔙 Retour', callback_data: serviceCallback }]];
    const state = userStates.get(userId) || {};
    
    let result;
    if (submenu.image) {
        result = await sendOrEditPhoto(chatId, submenu.image, submenu.text || submenu.name, keyboard, messageId);
    } else {
        result = await sendOrEditMessage(chatId, submenu.text || submenu.name, keyboard, 'HTML', messageId);
    }
    
    // Sauvegarder le messageId pour les futures éditions
    userStates.set(userId, { ...state, messageId: result.message_id || messageId });
}

// Menu d'édition d'un réseau social
async function showSocialEditMenu(chatId, userId, socialId, messageId) {
    const social = await db.getSocialNetwork(socialId);
    
    if (!social) {
        await sendOrEditMessage(
            chatId,
            '❌ Réseau social non trouvé',
            [[{ text: '🔙 Retour', callback_data: 'admin_social' }]],
            'HTML',
            messageId
        );
        return;
    }
    
    await sendOrEditMessage(
        chatId,
        `${social.emoji} <b>${social.name}</b>\n\n` +
        `URL: ${social.url}\n` +
        `Position: ${social.position}`,
        [
            [{ text: '✏️ Modifier le nom', callback_data: `edit_social_name_${socialId}` }],
            [{ text: '���0 Modifier l\'emoji', callback_data: `edit_social_emoji_${socialId}` }],
            [{ text: '🔗 Modifier l\'URL', callback_data: `edit_social_url_${socialId}` }],
            [{ text: '🗑️ Supprimer', callback_data: `delete_social_${socialId}` }],
            [{ text: '🔙 Retour', callback_data: 'admin_social' }]
        ],
        'HTML',
        messageId
    );
}

// Menu d'édition d'un sous-menu
async function showSubmenuEditMenu(chatId, userId, serviceType, submenuId, messageId) {
    const submenu = await db.getSubmenu(submenuId);
    
    if (!submenu) {
        await sendOrEditMessage(
            chatId,
            '❌ Sous-menu non trouvé',
            [[{ text: '🔙 Retour', callback_data: `manage_submenus_${serviceType}` }]],
            'HTML',
            messageId
        );
        return;
    }
    
    await sendOrEditMessage(
        chatId,
        `📋 <b>${submenu.name}</b>\n\n` +
        `Service: ${submenu.service_type}\n` +
        `Position: ${submenu.position}`,
        [
            [{ text: '✏️ Modifier le nom', callback_data: `edit_submenu_name_${serviceType}_${submenuId}` }],
            [{ text: '📝 Modifier le texte', callback_data: `edit_submenu_text_${serviceType}_${submenuId}` }],
            [{ text: '🖼️ Modifier la photo', callback_data: `edit_submenu_photo_${serviceType}_${submenuId}` }],
            [{ text: '🗑️ Supprimer', callback_data: `delete_submenu_${submenuId}` }],
            [{ text: '🔙 Retour', callback_data: `manage_submenus_${serviceType}` }]
        ],
        'HTML',
        messageId
    );
}

// Démarrage du bot
bot.on('polling_error', (error) => {
    console.error('Erreur de polling:', error);
});

console.log('🤖 Bot démarré avec succès !');
console.log('🗃️ Backend base de données: SQLite');
console.log('✅ Toutes les fonctionnalités sont actives');