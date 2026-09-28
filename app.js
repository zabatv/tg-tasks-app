(() => {
  const tg = window.Telegram?.WebApp;
  // initData пустой, если страница открыта не из Telegram
  const inTelegram = Boolean(tg && tg.initData);
  const STORAGE_KEY = "tasks";

  const $ = (id) => document.getElementById(id);
  const els = {
    list: $("list"), empty: $("empty"), emptyText: $("emptyText"),
    sheet: $("sheet"), form: $("form"), title: $("title"), priority: $("priority"),
    fab: $("fab"), backdrop: $("sheetBackdrop"), greeting: $("greeting"),
    progressBar: $("progressBar"), progressText: $("progressText"),
    countAll: $("countAll"), countActive: $("countActive"), countDone: $("countDone"),
  };

  let tasks = [];
  let filter = "all";
  let priority = "mid";

  // ---------- Хранилище: CloudStorage в Telegram (+ локальная копия), localStorage в браузере ----------
  const useCloud = inTelegram && tg.isVersionAtLeast("6.9");
  const readLocal = () => { try { return parse(localStorage.getItem(STORAGE_KEY)); } catch { return []; } };

  const storage = {
    load() {
      if (!useCloud) return Promise.resolve(readLocal());
      return new Promise((resolve) => {
        // Если облако не ответило вовремя, берём локальную копию
        const timer = setTimeout(() => resolve(readLocal()), 3000);
        tg.CloudStorage.getItem(STORAGE_KEY, (err, value) => {
          clearTimeout(timer);
          resolve(err || !value ? readLocal() : parse(value));
        });
      });
    },
    save(data) {
      const value = JSON.stringify(data);
      try { localStorage.setItem(STORAGE_KEY, value); } catch {}
      if (useCloud) tg.CloudStorage.setItem(STORAGE_KEY, value);
    },
  };

  function parse(value) {
    try { return Array.isArray(JSON.parse(value)) ? JSON.parse(value) : []; } catch { return []; }
  }

  const haptic = {
    tap: () => tg?.HapticFeedback?.impactOccurred("light"),
    success: () => tg?.HapticFeedback?.notificationOccurred("success"),
    warn: () => tg?.HapticFeedback?.notificationOccurred("warning"),
  };

  // ---------- Рендер ----------
  const PRIORITY_LABEL = { low: "Низкий", mid: "Средний", high: "Высокий" };
  const PRIORITY_ORDER = { high: 0, mid: 1, low: 2 };

  function render() {
    const done = tasks.filter((t) => t.done).length;
    const total = tasks.length;
    const percent = total ? Math.round((done / total) * 100) : 0;

    els.countAll.textContent = total;
    els.countActive.textContent = total - done;
    els.countDone.textContent = done;
    els.progressText.textContent = `${percent}%`;
    els.progressBar.style.strokeDashoffset = 100 - percent;

    const visible = tasks
      .filter((t) => filter === "all" || (filter === "done" ? t.done : !t.done))
      .sort((a, b) => a.done - b.done || PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || b.created - a.created);

    els.list.replaceChildren(...visible.map(renderItem));
    els.empty.hidden = visible.length > 0;
    els.emptyText.textContent =
      filter === "done" ? "Выполненных задач нет" :
      filter === "active" && total ? "Все задачи выполнены 🎉" : "Задач пока нет";
  }

  function renderItem(task) {
    const li = document.createElement("li");
    li.className = "item" + (task.done ? " done" : "");
    li.dataset.priority = task.priority;
    li.dataset.id = task.id;

    const check = document.createElement("button");
    check.className = "check";
    check.dataset.action = "toggle";
    check.setAttribute("aria-label", task.done ? "Отметить невыполненной" : "Отметить выполненной");

    const body = document.createElement("div");
    body.className = "item-body";
    body.dataset.action = "toggle";
    const title = document.createElement("p");
    title.className = "item-title";
    title.textContent = task.title;
    const meta = document.createElement("p");
    meta.className = "item-meta";
    meta.textContent = `${PRIORITY_LABEL[task.priority]} · ${formatDate(task.created)}`;
    body.append(title, meta);

    const del = document.createElement("button");
    del.className = "delete";
    del.dataset.action = "delete";
    del.setAttribute("aria-label", "Удалить");
    del.textContent = "×";

    li.append(check, body, del);
    return li;
  }

  function formatDate(ts) {
    return new Date(ts).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  }

  function commit() {
    storage.save(tasks);
    render();
  }

  // ---------- Действия ----------
  function addTask(title) {
    tasks.push({ id: Date.now().toString(36), title, priority, done: false, created: Date.now() });
    haptic.success();
    commit();
  }

  function toggleTask(id) {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    task.done = !task.done;
    task.done ? haptic.success() : haptic.tap();
    commit();
  }

  function deleteTask(id) {
    const remove = () => {
      tasks = tasks.filter((t) => t.id !== id);
      haptic.warn();
      commit();
    };
    if (inTelegram && tg.isVersionAtLeast("6.2")) {
      tg.showConfirm("Удалить задачу?", (ok) => ok && remove());
    } else {
      remove();
    }
  }

  // ---------- Экран добавления ----------
  function openSheet() {
    haptic.tap();
    els.form.reset();
    setPriority("mid");
    els.sheet.hidden = false;
    els.title.focus();
    if (inTelegram) {
      tg.MainButton.setText("Сохранить");
      tg.BackButton.show();
    }
  }

  function closeSheet() {
    els.sheet.hidden = true;
    els.title.blur();
    if (inTelegram) {
      tg.MainButton.setText("Добавить задачу");
      tg.BackButton.hide();
    }
  }

  function submit() {
    const title = els.title.value.trim();
    if (!title) {
      haptic.warn();
      els.title.focus();
      return;
    }
    addTask(title);
    closeSheet();
  }

  function setPriority(value) {
    priority = value;
    for (const chip of els.priority.children) chip.classList.toggle("active", chip.dataset.value === value);
  }

  // ---------- События ----------
  els.list.addEventListener("click", (e) => {
    const target = e.target.closest("[data-action]");
    if (!target) return;
    const id = target.closest(".item").dataset.id;
    if (target.dataset.action === "toggle") toggleTask(id);
    if (target.dataset.action === "delete") deleteTask(id);
  });

  document.querySelector(".tabs").addEventListener("click", (e) => {
    const tab = e.target.closest(".tab");
    if (!tab || tab.dataset.filter === filter) return;
    filter = tab.dataset.filter;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    tg?.HapticFeedback?.selectionChanged();
    render();
  });

  els.priority.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    tg?.HapticFeedback?.selectionChanged();
    setPriority(chip.dataset.value);
  });

  els.form.addEventListener("submit", (e) => {
    e.preventDefault();
    submit();
  });
  els.fab.addEventListener("click", openSheet);
  els.backdrop.addEventListener("click", closeSheet);
  document.addEventListener("keydown", (e) => e.key === "Escape" && !els.sheet.hidden && closeSheet());

  // ---------- Инициализация ----------
  if (inTelegram) {
    document.documentElement.classList.add("tg");
    tg.ready();
    tg.expand();

    const name = tg.initDataUnsafe?.user?.first_name;
    if (name) els.greeting.textContent = `Привет, ${name}!`;

    tg.MainButton.setText("Добавить задачу");
    tg.MainButton.show();
    tg.MainButton.onClick(() => (els.sheet.hidden ? openSheet() : submit()));
    tg.BackButton.onClick(closeSheet);
  }

  storage.load().then((data) => {
    tasks = data;
    render();
  });
})();
