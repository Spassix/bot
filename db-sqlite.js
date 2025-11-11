const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Classe pour gérer la base de données SQLite
class SQLiteDatabase {
    constructor() {
        // Créer ou ouvrir la base de données avec nom personnalisé
        const dbName = process.env.DB_NAME || 'bot.db';
        const dbPath = path.join(__dirname, dbName);
        this.db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error('Erreur lors de l\'ouverture de la base de données:', err);
            } else {
                console.log(`✅ Base de données SQLite connectée: ${dbName}`);
                this.initDatabase();
            }
        });
    }

    // Initialiser les tables
    async initDatabase() {
        const queries = [
            // Table de configuration
            `CREATE TABLE IF NOT EXISTS config (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                welcome_message TEXT DEFAULT '🤖 Bienvenue {firstname} sur notre bot!',
                welcome_image TEXT,
                info_text TEXT DEFAULT 'ℹ️ Informations sur notre service',
                mini_app_url TEXT,
                mini_app_text TEXT DEFAULT '🎮 Ouvrir l''application',
                livraison_text TEXT DEFAULT '🚚 SERVICE LIVRAISON\n\nContactez-nous pour vos livraisons',
                livraison_image TEXT,
                postal_text TEXT DEFAULT '📮 SERVICE POSTAL\n\nEnvoi de colis et courriers',
                postal_image TEXT,
                meetup_text TEXT DEFAULT '📍 SERVICE MEET UP\n\nOrganisation de rencontres',
                meetup_image TEXT,
                catalogue_url TEXT,
                social_buttons_per_row INTEGER DEFAULT 2,
                buttons_per_row INTEGER DEFAULT 2,
                buttons_layout TEXT,
                enabled_services TEXT,
                custom_buttons_json TEXT
            )`,

            // Insérer la configuration par défaut si elle n'existe pas
            `INSERT OR IGNORE INTO config (id) VALUES (1)`,

            // Table des utilisateurs
            `CREATE TABLE IF NOT EXISTS users (
                user_id INTEGER PRIMARY KEY,
                username TEXT,
                first_name TEXT,
                last_name TEXT,
                is_admin INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Table des réseaux sociaux
            `CREATE TABLE IF NOT EXISTS social_networks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                emoji TEXT NOT NULL,
                url TEXT NOT NULL,
                position INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1
            )`,

            // Table des sous-menus
            `CREATE TABLE IF NOT EXISTS service_submenus (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                service_type TEXT NOT NULL,
                name TEXT NOT NULL,
                text TEXT,
                image TEXT,
                position INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1
            )`,

            // Table des statistiques
            `CREATE TABLE IF NOT EXISTS stats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_type TEXT NOT NULL,
                user_id INTEGER,
                data TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Table des états utilisateur
            `CREATE TABLE IF NOT EXISTS user_states (
                user_id INTEGER PRIMARY KEY,
                state TEXT,
                data TEXT,
                message_id INTEGER,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`
        ];

        // Exécuter toutes les requêtes d'initialisation
        for (const query of queries) {
            await this.run(query);
        }

        // Ajouter les réseaux sociaux par défaut s'ils n'existent pas
        const socialCount = await this.get("SELECT COUNT(*) as count FROM social_networks");
        if (socialCount.count === 0) {
            const defaultSocials = [
                { name: 'Instagram', emoji: '📷', url: 'https://instagram.com', position: 1 },
                { name: 'Telegram', emoji: '📢', url: 'https://t.me/channel', position: 2 },
                { name: 'WhatsApp', emoji: '💬', url: 'https://wa.me/1234567890', position: 3 }
            ];

            for (const social of defaultSocials) {
                await this.run(
                    "INSERT INTO social_networks (name, emoji, url, position) VALUES (?, ?, ?, ?)",
                    [social.name, social.emoji, social.url, social.position]
                );
            }
        }

        // Ajouter des sous-menus par défaut s'ils n'existent pas
        const submenuCount = await this.get("SELECT COUNT(*) as count FROM service_submenus");
        if (submenuCount.count === 0) {
            const defaultSubmenus = [
                { service_type: 'livraison', name: 'Livraison Express', text: '🚚 Livraison en 24h', position: 1 },
                { service_type: 'livraison', name: 'Livraison Standard', text: '📦 Livraison en 3-5 jours', position: 2 },
                { service_type: 'postal', name: 'Envoi National', text: '📮 Envoi dans tout le pays', position: 1 },
                { service_type: 'postal', name: 'Envoi International', text: '🌍 Envoi à l\'étranger', position: 2 },
                { service_type: 'meetup', name: 'Rencontre Café', text: '☕ Rencontre dans un café', position: 1 },
                { service_type: 'meetup', name: 'Rencontre Bureau', text: '🏢 Rencontre au bureau', position: 2 }
            ];

            for (const submenu of defaultSubmenus) {
                await this.run(
                    "INSERT INTO service_submenus (service_type, name, text, position, is_active) VALUES (?, ?, ?, ?, ?)",
                    [submenu.service_type, submenu.name, submenu.text, submenu.position, 1]
                );
            }
        }

        // Migration: ajouter les colonnes buttons_layout et enabled_services si absentes
        try {
            const columns = await this.all("PRAGMA table_info(config)");
            const hasButtonsLayout = Array.isArray(columns) && columns.some(c => c.name === 'buttons_layout');
            if (!hasButtonsLayout) {
                await this.run("ALTER TABLE config ADD COLUMN buttons_layout TEXT");
            }
            const hasEnabledServices = Array.isArray(columns) && columns.some(c => c.name === 'enabled_services');
            if (!hasEnabledServices) {
                await this.run("ALTER TABLE config ADD COLUMN enabled_services TEXT");
                await this.updateConfig({ enabled_services: JSON.stringify(['liv','pos','meet','contact']) });
            }
            const hasCustomButtons = Array.isArray(columns) && columns.some(c => c.name === 'custom_buttons_json');
            if (!hasCustomButtons) {
                await this.run("ALTER TABLE config ADD COLUMN custom_buttons_json TEXT");
                await this.updateConfig({ custom_buttons_json: JSON.stringify([]) });
            }
        } catch (e) {
            console.warn('Migration config échouée:', e.message || e);
        }
    }

    // Méthode utilitaire pour exécuter une requête
    run(query, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(query, params, function(err) {
                if (err) reject(err);
                else resolve({ lastID: this.lastID, changes: this.changes });
            });
        });
    }

    // Méthode utilitaire pour récupérer une ligne
    get(query, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(query, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    // Méthode utilitaire pour récupérer plusieurs lignes
    all(query, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    // Configuration
    async getConfig() {
        return await this.get("SELECT * FROM config WHERE id = 1");
    }

    async updateConfig(updates) {
        const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
        const values = Object.values(updates);
        await this.run(`UPDATE config SET ${fields} WHERE id = 1`, values);
        return true;
    }

    // Utilisateurs
    async getUser(userId) {
        return await this.get("SELECT * FROM users WHERE user_id = ?", [userId]);
    }

    async upsertUser(userId, username, firstName, lastName) {
        const isAdmin = userId.toString() === process.env.ADMIN_ID ? 1 : 0;
        await this.run(
            `INSERT INTO users (user_id, username, first_name, last_name, is_admin, last_seen) 
             VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP) 
             ON CONFLICT(user_id) DO UPDATE SET 
             username = excluded.username,
             first_name = excluded.first_name,
             last_name = excluded.last_name,
             last_seen = CURRENT_TIMESTAMP`,
            [userId, username, firstName, lastName, isAdmin]
        );
        return await this.getUser(userId);
    }

    async getAllUsers() {
        return await this.all("SELECT * FROM users");
    }

    async getAdmins() {
        return await this.all("SELECT * FROM users WHERE is_admin = 1");
    }

    async setAdmin(userId, isAdmin) {
        const result = await this.run(
            "UPDATE users SET is_admin = ? WHERE user_id = ?",
            [isAdmin ? 1 : 0, userId]
        );
        return result.changes > 0;
    }

    // Réseaux sociaux
    async getSocialNetworks() {
        return await this.all(
            "SELECT * FROM social_networks WHERE is_active = 1 ORDER BY position"
        );
    }

    async getSocialNetwork(id) {
        return await this.get("SELECT * FROM social_networks WHERE id = ?", [id]);
    }

    async addSocialNetwork(name, emoji, url) {
        const maxPos = await this.get(
            "SELECT MAX(position) as max_pos FROM social_networks"
        );
        const position = (maxPos.max_pos || 0) + 1;
        
        const result = await this.run(
            "INSERT INTO social_networks (name, emoji, url, position) VALUES (?, ?, ?, ?)",
            [name, emoji, url, position]
        );
        
        return await this.getSocialNetwork(result.lastID);
    }

    async updateSocialNetwork(id, updates) {
        const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
        const values = [...Object.values(updates), id];
        const result = await this.run(
            `UPDATE social_networks SET ${fields} WHERE id = ?`,
            values
        );
        return result.changes > 0;
    }

    async deleteSocialNetwork(id) {
        const result = await this.run(
            "DELETE FROM social_networks WHERE id = ?",
            [id]
        );
        return result.changes > 0;
    }

    // Sous-menus des services
    async getServiceSubmenus(serviceType) {
        return await this.all(
            "SELECT * FROM service_submenus WHERE service_type = ? AND is_active = 1 ORDER BY position",
            [serviceType]
        );
    }

    async getSubmenu(id) {
        return await this.get("SELECT * FROM service_submenus WHERE id = ?", [parseInt(id)]);
    }

    async addSubmenu(serviceType, name, text, image) {
        const maxPos = await this.get(
            "SELECT MAX(position) as max_pos FROM service_submenus WHERE service_type = ?",
            [serviceType]
        );
        const position = (maxPos.max_pos || 0) + 1;
        
        const result = await this.run(
            "INSERT INTO service_submenus (service_type, name, text, image, position) VALUES (?, ?, ?, ?, ?)",
            [serviceType, name, text, image, position]
        );
        
        return await this.getSubmenu(result.lastID);
    }

    async updateSubmenu(id, updates) {
        const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
        const values = [...Object.values(updates), parseInt(id)];
        const result = await this.run(
            `UPDATE service_submenus SET ${fields} WHERE id = ?`,
            values
        );
        return result.changes > 0;
    }

    async deleteSubmenu(id) {
        const result = await this.run(
            "DELETE FROM service_submenus WHERE id = ?",
            [parseInt(id)]
        );
        return result.changes > 0;
    }

    // Statistiques
    async logEvent(eventType, userId, data = null) {
        await this.run(
            "INSERT INTO stats (event_type, user_id, data) VALUES (?, ?, ?)",
            [eventType, userId, data ? JSON.stringify(data) : null]
        );
    }

    async getStats() {
        const totalUsers = await this.get("SELECT COUNT(*) as count FROM users");
        const totalStarts = await this.get("SELECT COUNT(*) as count FROM stats WHERE event_type = 'start'");
        const totalAdmins = await this.get("SELECT COUNT(*) as count FROM users WHERE is_admin = 1");
        
        return {
            totalUsers: totalUsers.count,
            totalStarts: totalStarts.count,
            totalAdmins: totalAdmins.count
        };
    }

    async getDetailedStats() {
        const basic = await this.getStats();
        
        const todayUsers = await this.get(
            "SELECT COUNT(*) as count FROM stats WHERE event_type = 'start' AND date(created_at) = date('now')"
        );
        
        const weekUsers = await this.get(
            "SELECT COUNT(*) as count FROM stats WHERE event_type = 'start' AND date(created_at) >= date('now', '-7 days')"
        );
        
        return {
            ...basic,
            todayUsers: todayUsers.count,
            weekUsers: weekUsers.count
        };
    }

    // États utilisateur
    async getUserState(userId) {
        return await this.get("SELECT * FROM user_states WHERE user_id = ?", [userId]);
    }

    async setUserState(userId, state, data = null, messageId = null) {
        await this.run(
            `INSERT INTO user_states (user_id, state, data, message_id, updated_at) 
             VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP) 
             ON CONFLICT(user_id) DO UPDATE SET 
             state = excluded.state,
             data = excluded.data,
             message_id = excluded.message_id,
             updated_at = CURRENT_TIMESTAMP`,
            [userId, state, data ? JSON.stringify(data) : null, messageId]
        );
    }

    async deleteUserState(userId) {
        const result = await this.run(
            "DELETE FROM user_states WHERE user_id = ?",
            [userId]
        );
        return result.changes > 0;
    }

    // Fermer la connexion
    close() {
        return new Promise((resolve, reject) => {
            this.db.close((err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }
}

module.exports = { SQLiteDatabase };