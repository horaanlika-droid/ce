/**
 * Мостик к Telegram WebApp. Вне Telegram всё деградирует в безопасные заглушки,
 * поэтому витрина работает и как обычный сайт.
 */
const w = window.Telegram?.WebApp;

if (w) {
  try {
    w.ready();
    w.expand();
    w.setHeaderColor?.('#05070d');
    w.setBackgroundColor?.('#05070d');
    w.disableVerticalSwipes?.();
  } catch {}
}

export const inTelegram = Boolean(w);

export const tg = {
  get raw() { return w; },
  get initData() { return w?.initData || ''; },
  get startParam() { return w?.initDataUnsafe?.start_param || ''; },
  get user() { return w?.initDataUnsafe?.user || null; },
  expand() { w?.expand?.(); },
  close() { w?.close?.(); },
  haptic(type = 'light') {
    try {
      const h = w?.HapticFeedback;
      if (!h) {
        if (type === 'success' || type === 'error') navigator.vibrate?.(30);
        return;
      }
      if (type === 'success' || type === 'error' || type === 'warning') h.notificationOccurred(type);
      else h.impactOccurred(type);
    } catch {}
  },
  mainButton: {
    show(text, onClick) {
      if (!w) return;
      w.MainButton.setText(text);
      w.MainButton.show();
      w.MainButton.onClick(this._fn = () => onClick());
    },
    hide() {
      if (!w) return;
      if (this._fn) w.MainButton.offClick(this._fn);
      w.MainButton.hide();
    },
  },
  backButton: {
    show(onClick) {
      if (!w) return;
      w.BackButton.show();
      w.BackButton.onClick(this._fn = () => onClick());
    },
    hide() {
      if (!w) return;
      if (this._fn) w.BackButton.offClick(this._fn);
      w.BackButton.hide();
    },
  },
  openLink(url) {
    if (w?.openLink) w.openLink(url);
    else window.open(url, '_blank');
  },
  openTelegramLink(url) {
    if (w?.openTelegramLink) w.openTelegramLink(url);
    else window.open(url, '_blank');
  },
};

if (inTelegram) document.documentElement.classList.add('tg-native');
