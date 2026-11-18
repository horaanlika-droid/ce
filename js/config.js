/**
 * Cocktail Embassy — runtime configuration.
 *
 * apiBase: URL of the order/back-office API (the BotHost service in /server).
 *   Leave empty to run the site as a static catalogue on GitHub Pages.
 *   Example: "https://cocktail-embassy.bothost.ru"
 *
 *   For local admin-panel editing, run `python main.py` in /server and set:
 *     apiBase: "http://localhost:8080"
 *   then open #/admin in the browser and log in with ADMIN_PASSWORD.
 *
 * The site keeps working with bundled data (data/content.json) when the API
 * is unreachable, so GitHub Pages always renders a full catalogue.
 */
window.CE_CONFIG = {
  apiBase: "",
  telegramAdmin: "",
  requestEmail: "bartending.solution.uae@gmail.com",
};
