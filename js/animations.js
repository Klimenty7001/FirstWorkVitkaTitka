/* ============================================================
   МАСТЕР ВИКТОР — анимации появления (бумажный коллаж).
   Нативный JS, IntersectionObserver, без библиотек.

   Принцип прогрессивного улучшения:
   • класс js-anim ставится только после успешной инициализации,
     поэтому без JS (или при prefers-reduced-motion) весь контент
     сразу виден;
   • обычные элементы показываются однократно (unobserve);
   • элементы с data-reveal-repeat (карточки, стикеры, стрелки)
     проигрывают анимацию заново при каждом входе в экран:
     выход за экран снимает .was-in, повторный вход ставит .is-in;
     гистерезис обеспечивают разные rootMargin у наблюдателей;
   • страховочный rAF-sweep на время прокрутки добирает элементы,
     перескоченные при очень быстрой прокрутке, и отключается,
     когда всё показано.
   ============================================================ */
(function () {
  'use strict';

  var root = document.documentElement;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  // 1. Без анимаций: reduce или нет IntersectionObserver → всё видно.
  if (reduce.matches || !('IntersectionObserver' in window)) return;
  root.classList.add('js-anim');

  var STAGGER_STEP = 90;   // мс между карточками
  var STAGGER_CAP = 4;     // цепочка не длиннее 5 шагов
  var CLEANUP_MS = 850;    // запас на transition, затем «закрываем» показ

  var io = new IntersectionObserver(onIntersect, {
    threshold: 0.1,
    rootMargin: '0px 0px -8% 0px'
  });

  // Наблюдатель выхода: элемент считается «ушедшим» только когда
  // целиком покинул экран (+2% запас) — пока он у кромки, состояние
  // не сбрасывается, поэтому нет мерцания на границе.
  var ioExit = new IntersectionObserver(onExit, {
    threshold: 0,
    rootMargin: '0px 0px 2% 0px'
  });

  var pending = []; // элементы (и группы), ожидающие первого показа

  function isRepeat(el) { return el.hasAttribute('data-reveal-repeat'); }

  // --- показ одного элемента ---------------------------------------------
  function show(el, delay) {
    var repeat = isRepeat(el);
    if (el.__done && !repeat) return;
    if (el.__done && repeat && el.classList.contains('is-in')) return;
    el.__done = true;
    if (delay > 0) el.style.transitionDelay = delay + 'ms';
    el.classList.add('is-in');
    window.setTimeout(function () {
      el.style.transitionDelay = '';
      el.classList.remove('is-in');
      if (repeat) {
        el.classList.add('was-in');   // остаётся видимым, ждёт replay
      } else {
        el.removeAttribute('data-reveal'); // возврат к базовым стилям
      }
    }, (delay || 0) + CLEANUP_MS);
  }

  // --- показ группы карточек со ступенчатой задержкой --------------------
  function showGroup(group) {
    var kids = group.__kids;
    for (var i = 0; i < kids.length; i++) {
      show(kids[i], Math.min(i, STAGGER_CAP) * STAGGER_STEP);
    }
  }

  function reveal(target) {
    if (!isRepeat(target)) io.unobserve(target);
    if (target.__kids) { showGroup(target); } else {
      show(target, parseInt(target.getAttribute('data-reveal-delay') || '0', 10));
    }
  }

  // --- IntersectionObserver: вход в экран --------------------------------
  function onIntersect(entries) {
    for (var i = 0; i < entries.length; i++) {
      var en = entries[i];
      if (!en.isIntersecting) continue;
      var idx = pending.indexOf(en.target);
      if (idx > -1) pending.splice(idx, 1);
      reveal(en.target);
    }
    if (pending.length === 0) stopSweep();
  }

  // --- сброс повторных элементов, целиком покинувших экран ----------------
  function onExit(entries) {
    for (var i = 0; i < entries.length; i++) {
      var en = entries[i];
      if (en.isIntersecting) continue;
      var el = en.target;
      if (!el.classList.contains('was-in') && !el.classList.contains('is-in')) continue;
      el.classList.remove('was-in', 'is-in');
      el.style.transitionDelay = '';
      el.__done = false;
    }
  }

  // --- инициализация наблюдения ------------------------------------------
  var groups = document.querySelectorAll('[data-stagger]');
  var i, j;
  for (i = 0; i < groups.length; i++) {
    var g = groups[i];
    // только прямые дети: вложенные стикеры наблюдаются отдельно
    g.__kids = [];
    var gRepeat = false;
    for (j = 0; j < g.children.length; j++) {
      if (g.children[j].hasAttribute('data-reveal')) {
        g.__kids.push(g.children[j]);
        if (isRepeat(g.children[j])) gRepeat = true;
      }
    }
    for (j = 0; j < g.__kids.length; j++) g.__kids[j].__group = g;
    g.setAttribute('data-reveal-repeat', ''); // группа повторяется, если повторяются дети
    if (!gRepeat) g.setAttribute('data-no-repeat', '');
    pending.push(g);
    io.observe(g);
  }
  var singles = document.querySelectorAll('[data-reveal]');
  for (i = 0; i < singles.length; i++) {
    if (singles[i].__group) continue; // вложен в stagger-группу
    pending.push(singles[i]);
    io.observe(singles[i]);
  }
  // наблюдение выхода — только за повторными элементами
  var repeaters = document.querySelectorAll('[data-reveal-repeat]');
  for (i = 0; i < repeaters.length; i++) {
    if (!repeaters[i].hasAttribute('data-no-repeat')) ioExit.observe(repeaters[i]);
  }
  for (i = 0; i < groups.length; i++) {
    if (groups[i].getAttribute('data-reveal-repeat') && !groups[i].hasAttribute('data-no-repeat')) {
      ioExit.observe(groups[i]);
    }
  }

  // --- страховка: элементы, перескоченные при быстрой прокрутке -----------
  // Работает только пока есть непоказанные элементы, затем снимается.
  var ticking = false;
  function sweep() {
    ticking = false;
    if (pending.length === 0) { stopSweep(); return; }
    var vh = window.innerHeight - 24;
    for (i = pending.length - 1; i >= 0; i--) {
      var el = pending[i];
      if (el.getBoundingClientRect().top < vh) {
        pending.splice(i, 1);
        reveal(el);
      }
    }
    if (pending.length === 0) stopSweep();
  }
  function requestSweep() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(sweep);
  }
  function stopSweep() {
    window.removeEventListener('scroll', requestSweep);
    window.removeEventListener('resize', requestSweep);
  }
  window.addEventListener('scroll', requestSweep, { passive: true });
  window.addEventListener('resize', requestSweep);
  sweep(); // моментальная инициализация видимых элементов

  // --- если пользователь включил reduce уже после загрузки ----------------
  function onReduceChange() {
    if (!reduce.matches) return;
    root.classList.remove('js-anim');
    io.disconnect();
    ioExit.disconnect();
    stopSweep();
    pending = [];
  }
  if (reduce.addEventListener) reduce.addEventListener('change', onReduceChange);
  else if (reduce.addListener) reduce.addListener(onReduceChange);
})();
