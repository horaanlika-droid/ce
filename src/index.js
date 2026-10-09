/**
 * Точка входа: один процесс поднимает и витрину, и бота (MODE=all|web|bot).
 */
import { config } from './config.js';
import { createServer } from './server.js';
import { selfHeal } from './catalog.js';

selfHeal();

if (config.mode !== 'bot') {
  const app = createServer();
  for (const port of config.webPorts) {
    app.listen(port, config.host, () => {
      if (port === config.webPorts[0]) {
        console.log(`[web] Mini App on ${config.webPorts.map((p) => `http://${config.host}:${p}`).join(', ')}`);
      }
    });
  }
}

if (config.mode !== 'web' && config.telegram.hasBot) {
  const { startBot } = await import('./bot/index.js');
  startBot().catch((err) => console.error('[bot] ошибка запуска:', err));
} else if (config.mode !== 'web') {
  console.log('[bot] BOT_TOKEN не задан — работаем только как сайт (гостевой режим)');
}
