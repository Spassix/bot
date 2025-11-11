// Classe pour gérer la base de données Cloudflare D1
class D1Database {
    constructor() {
        // En développement local, on simule D1 avec un objet en mémoire
        // En production, ceci sera remplacé par l'API D1 réelle
        this.mockData = {
            config: {
                welcome_message: '🤖 Bienvenue {firstname} sur notre bot!',
                welcome_image: null,
                info_text: 'ℹ️ Informations sur notre service',
                mini_app_url: null,
                mini_app_text: '🎮 Ouvrir l\'application',
                livraison_text: '🚚 SERVICE LIVRAISON\n\nContactez-nous pour vos livraisons',
                livraison_image: null,
                postal_text: '📮 SERVICE POSTAL\n\nEnvoi de colis et courriers',
                postal_image: null,
                meetup_text: '📍 SERVICE MEET UP\n\nOrganisation de rencontres',
                meetup_image: null,
                catalogue_url: 'https://example.com/catalogue',
                social_buttons_per_row: 2,
                buttons_per_row: 2
            },
            users: new Map(),
            socialNetworks: [
                { id: 1, name: 'Instagram', emoji: '📷', url: 'https://instagram.com', position: 1, is_active: true },
                { id: 2, name: 'Telegram', emoji: '📢', url: 'https://t.me/channel', position: 2, is_active: true },
                { id: 3, name: 'WhatsApp', emoji: '💬', url: 'https://wa.me/1234567890', position: 3, is_active: true }
            ],
            serviceSubmenus: new Map(),
            userStates: new Map(),
            stats: []
        };
    }

    // Configuration
    async getConfig() {
        // En production: const result = await DB.prepare("SELECT * FROM config WHERE id = 1").first();
        return this.mockData.config;
    }

    async updateConfig(updates) {
        // En production: await DB.prepare("UPDATE config SET ... WHERE id = 1").bind(...).run();
        Object.assign(this.mockData.config, updates);
        return true;
    }

    // Utilisateurs
    async getUser(userId) {
        // En production: const result = await DB.prepare("SELECT * FROM users WHERE user_id = ?").bind(userId).first();
        return this.mockData.users.get(userId);
    }

    async upsertUser(userId, username, firstName, lastName) {
        // En production: await DB.prepare("INSERT OR REPLACE INTO users ...").bind(...).run();
        const user = {
            user_id: userId,
            username,
            first_name: firstName,
            last_name: lastName,
            is_admin: userId.toString() === process.env.ADMIN_ID ? 1 : 0,
            created_at: new Date(),
            last_seen: new Date()
        };
        this.mockData.users.set(userId, user);
        return user;
    }

    async getAllUsers() {
        // En production: const { results } = await DB.prepare("SELECT * FROM users").all();
        return Array.from(this.mockData.users.values());
    }

    async getAdmins() {
        // En production: const { results } = await DB.prepare("SELECT * FROM users WHERE is_admin = 1").all();
        return Array.from(this.mockData.users.values()).filter(u => u.is_admin === 1);
    }

    async setAdmin(userId, isAdmin) {
        // En production: await DB.prepare("UPDATE users SET is_admin = ? WHERE user_id = ?").bind(isAdmin ? 1 : 0, userId).run();
        const user = this.mockData.users.get(userId);
        if (user) {
            user.is_admin = isAdmin ? 1 : 0;
            return true;
        }
        return false;
    }

    // Réseaux sociaux
    async getSocialNetworks() {
        // En production: const { results } = await DB.prepare("SELECT * FROM social_networks WHERE is_active = 1 ORDER BY position").all();
        return this.mockData.socialNetworks.filter(s => s.is_active).sort((a, b) => a.position - b.position);
    }

    async getSocialNetwork(id) {
        // En production: const result = await DB.prepare("SELECT * FROM social_networks WHERE id = ?").bind(id).first();
        return this.mockData.socialNetworks.find(s => s.id === parseInt(id));
    }

    async addSocialNetwork(name, emoji, url) {
        // En production: await DB.prepare("INSERT INTO social_networks ...").bind(...).run();
        const newId = Math.max(...this.mockData.socialNetworks.map(s => s.id)) + 1;
        const position = this.mockData.socialNetworks.length + 1;
        const social = { id: newId, name, emoji, url, position, is_active: true };
        this.mockData.socialNetworks.push(social);
        return social;
    }

    async updateSocialNetwork(id, updates) {
        // En production: await DB.prepare("UPDATE social_networks SET ... WHERE id = ?").bind(...).run();
        const index = this.mockData.socialNetworks.findIndex(s => s.id === parseInt(id));
        if (index >= 0) {
            Object.assign(this.mockData.socialNetworks[index], updates);
            return true;
        }
        return false;
    }

    async deleteSocialNetwork(id) {
        // En production: await DB.prepare("DELETE FROM social_networks WHERE id = ?").bind(id).run();
        const index = this.mockData.socialNetworks.findIndex(s => s.id === parseInt(id));
        if (index >= 0) {
            this.mockData.socialNetworks.splice(index, 1);
            return true;
        }
        return false;
    }

    // Sous-menus des services
    async getServiceSubmenus(serviceType) {
        // En production: const { results } = await DB.prepare("SELECT * FROM service_submenus WHERE service_type = ? AND is_active = 1 ORDER BY position").bind(serviceType).all();
        const submenus = [];
        for (const [id, submenu] of this.mockData.serviceSubmenus) {
            if (submenu.service_type === serviceType && submenu.is_active) {
                submenus.push(submenu);
            }
        }
        return submenus.sort((a, b) => a.position - b.position);
    }

    async getSubmenu(id) {
        // En production: const result = await DB.prepare("SELECT * FROM service_submenus WHERE id = ?").bind(id).first();
        const submenuId = parseInt(id);
        return this.mockData.serviceSubmenus.get(submenuId);
    }

    async addSubmenu(serviceType, name, text, image) {
        // En production: await DB.prepare("INSERT INTO service_submenus ...").bind(...).run();
        const newId = this.mockData.serviceSubmenus.size + 1;
        const position = Array.from(this.mockData.serviceSubmenus.values())
            .filter(s => s.service_type === serviceType).length + 1;
        const submenu = { id: newId, service_type: serviceType, name, text, image, position, is_active: true };
        this.mockData.serviceSubmenus.set(newId, submenu);
        return submenu;
    }

    async updateSubmenu(id, updates) {
        // En production: await DB.prepare("UPDATE service_submenus SET ... WHERE id = ?").bind(...).run();
        const submenuId = parseInt(id);
        const submenu = this.mockData.serviceSubmenus.get(submenuId);
        if (submenu) {
            Object.assign(submenu, updates);
            return true;
        }
        return false;
    }

    async deleteSubmenu(id) {
        // En production: await DB.prepare("DELETE FROM service_submenus WHERE id = ?").bind(id).run();
        const submenuId = parseInt(id);
        return this.mockData.serviceSubmenus.delete(submenuId);
    }

    // Statistiques
    async logEvent(eventType, userId, data = null) {
        // En production: await DB.prepare("INSERT INTO stats ...").bind(...).run();
        this.mockData.stats.push({
            event_type: eventType,
            user_id: userId,
            data: data ? JSON.stringify(data) : null,
            created_at: new Date()
        });
    }

    async getStats() {
        // En production: requêtes SQL complexes
        const totalUsers = this.mockData.users.size;
        const totalStarts = this.mockData.stats.filter(s => s.event_type === 'start').length;
        const totalAdmins = Array.from(this.mockData.users.values()).filter(u => u.is_admin === 1).length;
        
        return { totalUsers, totalStarts, totalAdmins };
    }

    async getDetailedStats() {
        const basic = await this.getStats();
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
        
        const todayUsers = this.mockData.stats.filter(s => 
            s.event_type === 'start' && new Date(s.created_at) >= today
        ).length;
        
        const weekUsers = this.mockData.stats.filter(s => 
            s.event_type === 'start' && new Date(s.created_at) >= weekAgo
        ).length;
        
        return { ...basic, todayUsers, weekUsers };
    }

    // États utilisateur
    async getUserState(userId) {
        // En production: const result = await DB.prepare("SELECT * FROM user_states WHERE user_id = ?").bind(userId).first();
        return this.mockData.userStates.get(userId);
    }

    async setUserState(userId, state, data = null, messageId = null) {
        // En production: await DB.prepare("INSERT OR REPLACE INTO user_states ...").bind(...).run();
        this.mockData.userStates.set(userId, {
            user_id: userId,
            state,
            data: data ? JSON.stringify(data) : null,
            message_id: messageId,
            updated_at: new Date()
        });
    }

    async deleteUserState(userId) {
        // En production: await DB.prepare("DELETE FROM user_states WHERE user_id = ?").bind(userId).run();
        return this.mockData.userStates.delete(userId);
    }
}

module.exports = { D1Database };