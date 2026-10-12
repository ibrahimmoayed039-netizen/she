const STATUS = { new: 'بانتظار التحليل', routed: 'تم التوجيه', in_progress: 'قيد المعالجة', resolved: 'تم الحل' };
const PRI = { urgent: 'عاجلة', high: 'عالية', medium: 'متوسطة', low: 'منخفضة' };
let tab = 'new', list = [], settings = {};

function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e[k] = v;
  }
  kids.flat().forEach((x) => e.append(x ?? ''));
  return e;
}

function card(c) {
  const meta = [STATUS[c.status] || c.status, c.department, c.priority ? 'أولوية ' + PRI[c.priority] : ''].filter(Boolean).join(' • ');
  return h('div', { class: 'card' },
    h('h3', {}, c.title),
    h('small', {}, meta),
    c.imageB64 ? h('img', { src: 'data:image/jpeg;base64,' + c.imageB64 }) : '',
    h('p', {}, c.text),
    (c.name || c.phone) ? h('p', {}, 'المواطن: ' + c.name + ' ' + c.phone) : '',
    c.aiSummary ? h('p', { class: 'ai' }, '🤖 ' + c.aiSummary) : '',
    c.reply ? h('p', { class: 'reply' }, 'رد الموظف: ' + c.reply) : '',
    c.status === 'new' ? h('button', { class: 'act', onclick: () => window.api.analyze(c.id) }, 'تحليل وتوجيه الآن') : ''
  );
}

function renderSettings() {
  const key = h('input', { type: 'password', value: settings.apiKey || '' });
  const model = h('input', { type: 'text', value: settings.model || '' });
  const depts = h('textarea', { value: (settings.departments || []).join('\n') });
  const auto = h('input', { type: 'checkbox', checked: !!settings.auto });
  const path = h('span', {}, settings.serviceAccountPath || 'لم يُحدد بعد');
  return [
    h('div', { class: 'card' },
      h('label', {}, 'مفتاح Claude API'), key,
      h('label', {}, 'اسم النموذج'), model,
      h('label', {}, 'الأقسام (قسم في كل سطر — يجب أن تطابق أقسام الموظفين تماماً)'), depts,
      h('label', {}, auto, ' التحليل والتوجيه التلقائي للشكاوى الجديدة'),
      h('label', {}, 'مفتاح حساب خدمة Firebase (JSON)'),
      h('button', { class: 'act', onclick: async () => { path.textContent = await window.api.pickKey(); } }, 'اختيار الملف'), ' ', path,
      h('p', {}),
      h('button', {
        class: 'act',
        onclick: async () => {
          settings = {
            ...settings, apiKey: key.value.trim(), model: model.value.trim(), auto: auto.checked,
            departments: depts.value.split('\n').map((s) => s.trim()).filter(Boolean),
          };
          await window.api.setSettings(settings);
          await window.api.connect();
        },
      }, 'حفظ وإعادة الاتصال'))
  ];
}

function render() {
  const v = document.getElementById('view');
  v.replaceChildren();
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
  if (tab === 'settings') return v.append(...renderSettings());
  const items = list.filter((c) => (tab === 'new' ? c.status === 'new' : c.status !== 'new'));
  if (!items.length) return v.append(h('div', { class: 'empty' }, 'لا توجد شكاوى'));
  v.append(...items.map(card));
}

document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.t; render(); }));
window.api.onComplaints((d) => { list = d; if (tab !== 'settings') render(); });
window.api.onLog((m) => { document.getElementById('log').textContent = m; });
window.api.getSettings().then((s) => { settings = s; render(); });
