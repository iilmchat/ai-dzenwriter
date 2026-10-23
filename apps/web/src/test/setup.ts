import { configure } from '@testing-library/react';

// Полный прогон идёт параллельно с API-тестами: даём асинхронным запросам каталога
// больше времени, иначе отдельные findBy-проверки падают на медленном CI.
configure({ asyncUtilTimeout: 5000 });

// jsdom не реализует Range.getClientRects, а CodeMirror вызывает его при измерении строк.
// Пустой список прямоугольников достаточен: тесты проверяют содержимое, а не геометрию.
if (typeof Range !== 'undefined') {
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = () =>
      ({
        length: 0,
        item: () => null,
        [Symbol.iterator]: function* () {},
      }) as unknown as DOMRectList;
  }

  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = () => new DOMRect();
  }
}
