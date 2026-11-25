// Всички текстове на интерфейса на едно място (D-012).
// Етикетите на параметрите са в src/settings.js заедно със схемата им (D-013).
export const T = Object.freeze({
  appName: 'LrnOldGame',
  tabs: {
    today: 'Днес',
    explore: 'Изследвай',
    repertoire: 'Репертоар',
    train: 'Тренировка',
    settings: 'Настройки',
  },
  today: {
    title: 'Днес',
    empty: 'Тук ще виждаш колко позиции са за преговор днес и колко нови те чакат.',
  },
  explore: {
    title: 'Изследвай',
    empty: 'Началната позиция. Скоро тук ще разглеждаш ходовете от дървото на дебютите.',
    boardLabel: 'Шахматна дъска',
    loadError: 'Дъската не можа да се зареди.',
  },
  repertoire: {
    title: 'Репертоар',
    empty: 'Още нямаш линии в репертоара. Ще ги добавяш от „Изследвай“.',
  },
  train: {
    title: 'Тренировка',
    empty: 'Тук ще тренираш линиите от репертоара си.',
  },
  settings: {
    title: 'Настройки',
    intro: 'Промените се запазват веднага на това устройство.',
    reset: 'Върни стойностите по подразбиране',
    resetConfirm: 'Да върна ли всички настройки по подразбиране?',
    saved: 'Запазено',
    defaultHint: 'По подразбиране',
    range: 'Допустимо: {min}–{max}',
    about: 'За приложението',
    version: 'Версия',
    licenses: 'Лицензи: приложението е под MIT. Ползва chess.js (BSD-2-Clause), cm-chessboard (MIT) и фигури „standard“ от Wikimedia Commons (CC BY-SA 3.0).',
    offlineReady: 'Приложението работи и без интернет.',
    offlineNotReady: 'Офлайн режимът още се подготвя.',
  },
  update: {
    available: 'Има нова версия.',
    reload: 'Обнови',
  },
  notFound: 'Няма такъв екран.',
});

/** Прост шаблон: fmt('от {min}', {min: 1}) → 'от 1'. */
export function fmt(str, vars = {}) {
  return str.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}
