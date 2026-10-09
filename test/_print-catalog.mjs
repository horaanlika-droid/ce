// Помощник теста: печатает состояние каталога в текущем окружении (DATA_DIR).
import { catalogStatus, publicProducts, getBrand } from '../src/catalog.js';
console.log(JSON.stringify({ status: catalogStatus(), products: publicProducts().length, brand: getBrand().name }));
