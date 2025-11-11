-- Création des tables pour Cloudflare D1

-- Table de configuration
CREATE TABLE IF NOT EXISTS config (
    id INTEGER PRIMARY KEY,
    bot_id TEXT DEFAULT 'main',
    welcome_message TEXT DEFAULT '🤖 Bienvenue {firstname} sur notre bot!',
    welcome_image TEXT,
    info_text TEXT DEFAULT 'ℹ️ Informations sur notre service',
    mini_app_url TEXT,
    mini_app_text TEXT DEFAULT '🎮 Ouvrir l\'application',
    livraison_text TEXT DEFAULT '🚚 SERVICE LIVRAISON\n\nContactez-nous pour vos livraisons',
    livraison_image TEXT,
    postal_text TEXT DEFAULT '📮 SERVICE POSTAL\n\nEnvoi de colis et courriers',
    postal_image TEXT,
    meetup_text TEXT DEFAULT '📍 SERVICE MEET UP\n\nOrganisation de rencontres',
    meetup_image TEXT,
    catalogue_url TEXT DEFAULT 'https://example.com/catalogue',
    social_buttons_per_row INTEGER DEFAULT 2,
    buttons_per_row INTEGER DEFAULT 2,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Table des utilisateurs
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE NOT NULL,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    is_admin BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Table des réseaux sociaux
CREATE TABLE IF NOT EXISTS social_networks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    emoji TEXT DEFAULT '🔗',
    url TEXT NOT NULL,
    position INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Table des sous-menus des services
CREATE TABLE IF NOT EXISTS service_submenus (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_type TEXT NOT NULL, -- 'livraison', 'postal', 'meetup'
    name TEXT NOT NULL,
    text TEXT,
    image TEXT,
    position INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Table des états utilisateur (pour gérer les conversations)
CREATE TABLE IF NOT EXISTS user_states (
    user_id INTEGER PRIMARY KEY,
    state TEXT,
    data TEXT, -- JSON string pour stocker des données additionnelles
    message_id INTEGER,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Table des statistiques
CREATE TABLE IF NOT EXISTS stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL, -- 'start', 'admin', 'service_click', etc.
    user_id INTEGER,
    data TEXT, -- JSON string pour données additionnelles
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Insérer la configuration par défaut
INSERT OR IGNORE INTO config (id, bot_id) VALUES (1, 'main');

-- Insérer quelques réseaux sociaux par défaut
INSERT OR IGNORE INTO social_networks (name, emoji, url, position) VALUES 
    ('Instagram', '📷', 'https://instagram.com/votrecompte', 1),
    ('Telegram', '📢', 'https://t.me/votrechannel', 2),
    ('WhatsApp', '💬', 'https://wa.me/votrenuméro', 3);

-- Index pour optimiser les requêtes
CREATE INDEX IF NOT EXISTS idx_users_user_id ON users(user_id);
CREATE INDEX IF NOT EXISTS idx_user_states_user_id ON user_states(user_id);
CREATE INDEX IF NOT EXISTS idx_stats_created_at ON stats(created_at);
CREATE INDEX IF NOT EXISTS idx_service_submenus_service ON service_submenus(service_type, position);