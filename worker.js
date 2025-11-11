// Worker Cloudflare pour le bot Telegram avec D1

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Webhook endpoint pour Telegram
    if (url.pathname === '/webhook' && request.method === 'POST') {
      const update = await request.json();
      
      // Traiter la mise à jour Telegram
      await handleTelegramUpdate(update, env);
      
      return new Response('OK', { status: 200 });
    }
    
    // Endpoint pour définir le webhook
    if (url.pathname === '/setWebhook') {
      const webhookUrl = `https://${url.hostname}/webhook`;
      const telegramUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/setWebhook?url=${webhookUrl}`;
      
      const response = await fetch(telegramUrl);
      const result = await response.json();
      
      return new Response(JSON.stringify(result), {
        headers: { 'content-type': 'application/json' }
      });
    }
    
    // Page d'accueil
    return new Response('Bot Telegram avec Cloudflare D1', {
      headers: { 'content-type': 'text/plain' }
    });
  }
};

async function handleTelegramUpdate(update, env) {
  // Vérifier si c'est un message
  if (update.message) {
    await handleMessage(update.message, env);
  }
  // Vérifier si c'est un callback query
  else if (update.callback_query) {
    await handleCallbackQuery(update.callback_query, env);
  }
}

async function handleMessage(message, env) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = message.text;
  
  // Commande /start
  if (text === '/start') {
    await handleStartCommand(chatId, userId, message.from, env);
  }
  // Commande /admin
  else if (text === '/admin') {
    await handleAdminCommand(chatId, userId, env);
  }
  // Autres messages
  else {
    await handleTextMessage(message, env);
  }
}

async function handleStartCommand(chatId, userId, from, env) {
  // Enregistrer l'utilisateur
  await env.DB.prepare(`
    INSERT OR REPLACE INTO users (user_id, username, first_name, last_name, is_admin, last_seen)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).bind(
    userId,
    from.username || null,
    from.first_name || null,
    from.last_name || null,
    userId.toString() === env.ADMIN_ID ? 1 : 0
  ).run();
  
  // Enregistrer l'événement
  await env.DB.prepare(`
    INSERT INTO stats (event_type, user_id, created_at)
    VALUES ('start', ?, CURRENT_TIMESTAMP)
  `).bind(userId).run();
  
  // Récupérer la configuration
  const config = await env.DB.prepare("SELECT * FROM config WHERE id = 1").first();
  
  // Préparer le message
  const welcomeText = config.welcome_message.replace('{firstname}', from.first_name || 'utilisateur');
  
  // Créer le clavier
  const keyboard = await buildMainKeyboard(env, config);
  
  // Envoyer le message
  if (config.welcome_image) {
    await sendPhoto(chatId, config.welcome_image, welcomeText, keyboard, env);
  } else {
    await sendMessage(chatId, welcomeText, keyboard, env);
  }
}

async function handleAdminCommand(chatId, userId, env) {
  // Vérifier si admin
  const isAdmin = await checkAdmin(userId, env);
  
  if (!isAdmin) {
    await sendMessage(chatId, '❌ Accès refusé. Cette commande est réservée aux administrateurs.', null, env);
    return;
  }
  
  // Restriction au chat d'administration
  const adminChatId = env.ADMIN_CHAT_ID ? parseInt(env.ADMIN_CHAT_ID, 10) : null;
  if (adminChatId && chatId !== adminChatId) {
    await sendMessage(chatId, `ℹ️ Les commandes d'administration sont disponibles uniquement dans le chat admin.\nChat ID: ${adminChatId}`, null, env);
    return;
  }
  
  // Enregistrer l'événement
  await env.DB.prepare(`
    INSERT INTO stats (event_type, user_id, created_at)
    VALUES ('admin', ?, CURRENT_TIMESTAMP)
  `).bind(userId).run();
  
  // Afficher le menu admin
  await showAdminMenu(chatId, env);
}

async function handleCallbackQuery(query, env) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data;
  
  // Répondre au callback
  await answerCallbackQuery(query.id, env);
  
  // Restreindre les callbacks admin au chat dédié
  const isAdminCallback =
    data.startsWith('admin_') ||
    data.startsWith('edit_service_') ||
    data.startsWith('manage_submenus_') ||
    data.startsWith('add_submenu_') ||
    data.startsWith('edit_social_') ||
    data.startsWith('broadcast_') ||
    data.startsWith('miniapp_') ||
    data === 'add_admin' ||
    data === 'remove_admin' ||
    data.startsWith('confirm_remove_admin');

  if (isAdminCallback) {
    const isAdminUser = await checkAdmin(userId, env);
    if (!isAdminUser) {
      await sendMessage(chatId, '❌ Accès refusé. Cette action est réservée aux administrateurs.', null, env);
      return;
    }
    const adminChatId = env.ADMIN_CHAT_ID ? parseInt(env.ADMIN_CHAT_ID, 10) : null;
    if (adminChatId && chatId !== adminChatId) {
      await sendMessage(chatId, `ℹ️ Les actions d'administration sont disponibles uniquement dans le chat admin.\nChat ID: ${adminChatId}`, null, env);
      return;
    }
  }
  
  // Router selon le callback data
  switch(data) {
    case 'back_to_start':
      await handleStartCommand(chatId, userId, query.from, env);
      break;
      
    case 'info':
      const config = await env.DB.prepare("SELECT info_text FROM config WHERE id = 1").first();
      await editMessage(
        chatId,
        query.message.message_id,
        config.info_text || 'ℹ️ Informations',
        [[{ text: '🔙 Retour', callback_data: 'back_to_start' }]],
        env
      );
      break;
      
    case 'admin_back':
      if (await checkAdmin(userId, env)) {
        await showAdminMenu(chatId, env, query.message.message_id);
      }
      break;
      
    // Ajouter les autres cas ici...
    
    default:
      // Gérer les callbacks dynamiques
      if (data.startsWith('service_')) {
        await handleServiceCallback(data, chatId, userId, query.message.message_id, env);
      } else if (data.startsWith('submenu_')) {
        await handleSubmenuCallback(data, chatId, query.message.message_id, env);
      }
      // etc...
  }
}

async function handleTextMessage(message, env) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = message.text;
  
  // Récupérer l'état de l'utilisateur
  const userState = await env.DB.prepare(
    "SELECT * FROM user_states WHERE user_id = ?"
  ).bind(userId).first();
  
  if (!userState) return;
  
  // Restreindre les états admin au chat dédié
  const isAdminUser = await checkAdmin(userId, env);
  const isAdminState =
    userState.state === 'waiting_welcome' ||
    userState.state === 'adding_admin' ||
    userState.state === 'waiting_broadcast' ||
    (userState.state && (
      userState.state.startsWith('waiting_service_text_') ||
      userState.state.startsWith('waiting_service_photo_') ||
      userState.state.startsWith('editing_submenu_') ||
      userState.state.startsWith('waiting_miniapp_')
    ));
  const adminChatId = env.ADMIN_CHAT_ID ? parseInt(env.ADMIN_CHAT_ID, 10) : null;

  if (isAdminState) {
    if (!isAdminUser) {
      await sendMessage(chatId, '❌ Accès refusé. Cette action est réservée aux administrateurs.', null, env);
      return;
    }
    if (adminChatId && chatId !== adminChatId) {
      await sendMessage(chatId, `ℹ️ Les actions d'administration sont disponibles uniquement dans le chat admin.\nChat ID: ${adminChatId}`, null, env);
      return;
    }
  }
  
  // Traiter selon l'état
  switch(userState.state) {
    case 'waiting_welcome':
      await env.DB.prepare(
        "UPDATE config SET welcome_message = ? WHERE id = 1"
      ).bind(text).run();
      
      await env.DB.prepare(
        "DELETE FROM user_states WHERE user_id = ?"
      ).bind(userId).run();
      
      await editMessage(
        chatId,
        userState.message_id,
        '✅ Message d\'accueil mis à jour !',
        [[{ text: '🔙 Retour', callback_data: 'admin_back' }]],
        env
      );
      break;
      
    // Ajouter les autres cas...
  }
}

// Fonctions utilitaires

async function checkAdmin(userId, env) {
  if (userId.toString() === env.ADMIN_ID) return true;
  
  const user = await env.DB.prepare(
    "SELECT is_admin FROM users WHERE user_id = ?"
  ).bind(userId).first();
  
  return user?.is_admin === 1;
}

async function buildMainKeyboard(env, config) {
  const keyboard = [];
  
  // Mini app
  if (config.mini_app_url) {
    keyboard.push([{
      text: config.mini_app_text || '🎮 Ouvrir l\'application',
      web_app: { url: config.mini_app_url }
    }]);
  }
  
  // Services
  keyboard.push([{ text: '🚚 Livraison', callback_data: 'service_liv' }]);
  keyboard.push([{ text: '📮 Postal', callback_data: 'service_pos' }]);
  keyboard.push([{ text: '📍 Meet Up', callback_data: 'service_meet' }]);
  
  // Réseaux sociaux
  const socials = await env.DB.prepare(
    "SELECT * FROM social_networks WHERE is_active = 1 ORDER BY position"
  ).all();
  
  if (socials.results.length > 0) {
    const buttonsPerRow = config.social_buttons_per_row || 2;
    for (let i = 0; i < socials.results.length; i += buttonsPerRow) {
      const row = socials.results.slice(i, i + buttonsPerRow).map(social => ({
        text: `${social.emoji} ${social.name}`,
        url: social.url
      }));
      keyboard.push(row);
    }
  }
  
  // Catalogue
  if (config.catalogue_url) {
    keyboard.push([{ text: '📚 Catalogue', url: config.catalogue_url }]);
  }
  
  // Info
  keyboard.push([{ text: 'ℹ️ Info', callback_data: 'info' }]);
  
  return keyboard;
}

async function showAdminMenu(chatId, env, messageId = null) {
  // Statistiques
  const stats = await env.DB.prepare(`
    SELECT 
      (SELECT COUNT(*) FROM users) as totalUsers,
      (SELECT COUNT(*) FROM users WHERE is_admin = 1) as totalAdmins,
      (SELECT COUNT(*) FROM stats WHERE event_type = 'start') as totalStarts
  `).first();
  
  const text = `🔧 <b>Panel d'Administration</b>\n\n` +
               `👥 Utilisateurs: ${stats.totalUsers}\n` +
               `📊 Démarrages: ${stats.totalStarts}\n` +
               `👨‍💼 Admins: ${stats.totalAdmins}`;
  
  const keyboard = [
    [{ text: '✏️ Message d\'accueil', callback_data: 'admin_welcome' }],
    [{ text: '🖼️ Photo d\'accueil', callback_data: 'admin_photo' }],
    [{ text: '📱 Mini Application', callback_data: 'admin_miniapp' }],
    [{ text: '🔗 Gérer Réseaux Sociaux', callback_data: 'admin_social' }],
    [{ text: '🚚 Gérer Services', callback_data: 'admin_services' }],
    [{ text: '📊 Statistiques', callback_data: 'admin_stats' }],
    [{ text: '👥 Gérer Admins', callback_data: 'admin_manage' }],
    [{ text: '📢 Broadcast', callback_data: 'admin_broadcast' }]
  ];
  
  if (messageId) {
    await editMessage(chatId, messageId, text, keyboard, env);
  } else {
    await sendMessage(chatId, text, keyboard, env);
  }
}

// Fonctions API Telegram

async function sendMessage(chatId, text, keyboard, env) {
  const data = {
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML'
  };
  
  if (keyboard) {
    data.reply_markup = JSON.stringify({ inline_keyboard: keyboard });
  }
  
  await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

async function sendPhoto(chatId, photo, caption, keyboard, env) {
  const data = {
    chat_id: chatId,
    photo: photo,
    caption: caption,
    parse_mode: 'HTML'
  };
  
  if (keyboard) {
    data.reply_markup = JSON.stringify({ inline_keyboard: keyboard });
  }
  
  await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

async function editMessage(chatId, messageId, text, keyboard, env) {
  const data = {
    chat_id: chatId,
    message_id: messageId,
    text: text,
    parse_mode: 'HTML'
  };
  
  if (keyboard) {
    data.reply_markup = JSON.stringify({ inline_keyboard: keyboard });
  }
  
  await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

async function answerCallbackQuery(callbackQueryId, env) {
  await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId })
  });
}

// Handlers spécifiques

async function handleServiceCallback(data, chatId, userId, messageId, env) {
  const serviceType = data.replace('service_', '');
  const serviceMap = {
    'liv': 'livraison',
    'pos': 'postal',
    'meet': 'meetup'
  };
  
  const fullType = serviceMap[serviceType];
  const config = await env.DB.prepare("SELECT * FROM config WHERE id = 1").first();
  
  const text = config[`${fullType}_text`];
  const image = config[`${fullType}_image`];
  
  // Récupérer les sous-menus
  const submenus = await env.DB.prepare(
    "SELECT * FROM service_submenus WHERE service_type = ? AND is_active = 1 ORDER BY position"
  ).bind(fullType).all();
  
  const keyboard = [];
  
  for (const submenu of submenus.results) {
    keyboard.push([
      {
        text: submenu.name,
        callback_data: `submenu_${serviceType}_${submenu.id}`
      }
    ]);
  }
  
  keyboard.push([{ text: '🔙 Retour', callback_data: 'back_to_start' }]);
  
  if (image) {
    // Éditer avec photo
    await editMessageMedia(chatId, messageId, image, text, keyboard, env);
  } else {
    await editMessage(chatId, messageId, text, keyboard, env);
  }
}

async function handleSubmenuCallback(data, chatId, messageId, env) {
  const parts = data.split('_');
  const submenuId = parts[2];
  
  const submenu = await env.DB.prepare(
    "SELECT * FROM service_submenus WHERE id = ?"
  ).bind(submenuId).first();
  
  if (!submenu) return;
  
  const keyboard = [[{ 
    text: '🔙 Retour', 
    callback_data: `service_${submenu.service_type.slice(0, 3)}` 
  }]];
  
  if (submenu.image) {
    await editMessageMedia(chatId, messageId, submenu.image, submenu.text || submenu.name, keyboard, env);
  } else {
    await editMessage(chatId, messageId, submenu.text || submenu.name, keyboard, env);
  }
}

async function editMessageMedia(chatId, messageId, photo, caption, keyboard, env) {
  const data = {
    chat_id: chatId,
    message_id: messageId,
    media: JSON.stringify({
      type: 'photo',
      media: photo,
      caption: caption,
      parse_mode: 'HTML'
    })
  };
  
  if (keyboard) {
    data.reply_markup = JSON.stringify({ inline_keyboard: keyboard });
  }
  
  await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/editMessageMedia`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}