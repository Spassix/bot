# Bot Telegram - PHARMH**HI

Bot Telegram pour PHARMH**HI avec menu interactif et fonctionnalités de diffusion.

## Installation

1. Installez les dépendances :
```bash
pip install -r requirements.txt
```

2. Créez un fichier `.env` à partir du modèle `.env.example` et remplissez-le avec vos informations :
```bash
cp .env.example .env
```

3. Modifiez le fichier `.env` avec vos propres valeurs :
   - `BOT_TOKEN` : Token de votre bot Telegram
   - `ADMIN_ID` : Votre ID Telegram (pour la commande /broadcast)
   - Les URLs de vos liens

4. Ajoutez l'image du logo dans le dossier (nommée `pharmhashi_logo.png`)

5. **IMPORTANT** : Si vous déployez sur Render, arrêtez le bot local pour éviter les conflits.

6. Lancez le bot :
```bash
python bot.py
```

**Note pour le déploiement sur Render :**
- Le bot utilise automatiquement les webhooks sur Render
- Assurez-vous que le bot local est arrêté avant de déployer sur Render
- Les variables d'environnement doivent être configurées dans les paramètres Render

## Fonctionnalités

- **Menu interactif** avec boutons pour :
  - Mini App
  - Contact Instagram
  - Canal Secours
  - Contact Zangi

- **Commande /start** : Affiche le menu principal avec l'image du logo

- **Commande /broadcast** : Permet à l'admin de diffuser des messages (ID admin: 5627405035)

## Configuration

Le token du bot et les URLs sont configurés dans le fichier `bot.py`.

