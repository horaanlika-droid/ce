/**
 * Мини-шина событий: сервер сообщает боту о заказах и поддержке.
 */
import { EventEmitter } from 'node:events';

export const bus = new EventEmitter();
bus.setMaxListeners(20);

export function emit(event, payload) {
  bus.emit(event, payload);
}

export function on(event, handler) {
  bus.on(event, handler);
}
