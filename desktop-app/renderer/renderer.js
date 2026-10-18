const STATUS = { new: 'بانتظار التحليل', routed: 'تم التوجيه', in_progress: 'قيد المعالجة', resolved: 'تم الحل' };
const PRI = { urgent: 'عاجلة', high: 'عالية', medium: 'متوسطة', low: 'منخفضة' };
let tab = 'new', list = [], settings = {}, staff = [];

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

const fmtT = (ms) => new Date(ms).toLocaleString('ar-IQ', { dateStyle: 'short', timeStyle: 'short' });
function fmtD(ms) {
  if (ms < 0) return '-';
  const m = Math.round(ms / 60000);
  if (m < 60) return m + ' دقيقة';
  const h2 = Math.floor(m / 60);
  if (h2 < 48) return h2 + ' ساعة' + (m % 60 ? ' و' + (m % 60) + ' دقيقة' : '');
  return Math.floor(h2 / 24) + ' يوم' + (h2 % 24 ? ' و' + (h2 % 24) + ' ساعة' : '');
}
// بداية العمل الفعلي: استلام الكادر، وإلا بدء المعالجة، وإلا التوجيه
const workStart = (c) => c.crewMs || c.startedMs || c.routedMs || c.createdMs;

function timeline(c) {
  const rows = [
    ['📥 وصول الشكوى', c.createdMs],
    ['➡️ التوجيه إلى القسم', c.routedMs],
    ['🚧 استلام الكادر' + (c.crew ? ' (' + c.crew + ')' : ''), c.crewMs],
    ['🔧 بدء المعالجة', c.startedMs],
    ['✅ وقت الإنجاز', c.resolvedMs],
  ].filter((r) => r[1]);
  if (!rows.length) return '';
  const extra = [];
  if (c.resolvedMs) {
    extra.push('⏱ مدة الإنجاز من الاستلام: ' + fmtD(c.resolvedMs - workStart(c)));
    extra.push('⏱ المدة الكلية منذ وصول الشكوى: ' + fmtD(c.resolvedMs - c.createdMs));
  } else if (c.status !== 'new' && c.createdMs) {
    extra.push('⏳ مضى على الشكوى: ' + fmtD(Date.now() - c.createdMs) + ' ولم تُنجز بعد');
  }
  return h('div', { class: 'small' },
    ...rows.map((r) => h('div', {}, r[0] + ': ' + fmtT(r[1]))),
    ...extra.map((t) => h('div', { class: c.resolvedMs ? '' : 'warn' }, t)));
}

function logButton(id) {
  const box = h('div', { class: 'small' });
  const btn = h('button', { class: 'act', onclick: async () => {
    if (box.childNodes.length) { box.replaceChildren(); return; }
    const items = await window.api.getLog(id);
    if (!items.length) { box.append('لا يوجد سجل بعد'); return; }
    items.forEach((i) => box.append(h('div', {}, new Date(i.ms).toLocaleString('ar-IQ') + ' — ' + i.by + ': ' + i.action)));
  } }, '🕘 سجل الشكوى');
  return h('div', {}, btn, box);
}

const PRI_RANK = { urgent: 0, high: 1, medium: 2, low: 3 };

function priorityPicker(c) {
  if (c.status === 'new' || c.status === 'resolved') return '';
  const sel = h('select', { onchange: (e) => window.api.setPriority(c.id, e.target.value) },
    ...Object.entries(PRI).map(([k, v]) => h('option', { value: k }, v)));
  sel.value = c.priority || 'medium';
  return h('div', { class: 'small' }, 'تغيير الأولوية: ', sel);
}

function card(c) {
  const urgent = c.priority === 'urgent' && c.status !== 'resolved';
  const meta = [STATUS[c.status] || c.status, c.department, c.priority ? 'أولوية ' + PRI[c.priority] : ''].filter(Boolean).join(' • ');
  return h('div', { class: urgent ? 'card urgent' : 'card' },
    h('h3', {}, (urgent ? '🚨 ' : '') + c.title),
    h('small', {}, meta),
    c.imageB64 ? h('img', { src: 'data:image/jpeg;base64,' + c.imageB64 }) : '',
    h('p', {}, c.text),
    (c.name || c.phone) ? h('p', {}, 'المواطن: ' + c.name + ' ' + c.phone) : '',
    c.dupTitle ? h('p', { class: 'rep no' }, '🔁 مكررة: تشبه شكوى سابقة («' + c.dupTitle + '»)') : '',
    c.dupCount ? h('p', { class: 'small' }, '🔁 تكررت هذه الشكوى ' + c.dupCount + ' مرة') : '',
    c.lat !== null ? h('button', { class: 'act', onclick: () => window.api.openMap(c.lat, c.lng) }, '📍 فتح الموقع على الخريطة') : '',
    c.crew ? h('p', { class: 'rep yes' }, '🚧 الكادر المسؤول: ' + c.crew) : '',
    c.afterImageB64 ? h('div', {}, h('b', {}, 'صورة بعد الصيانة:'), h('img', { src: 'data:image/jpeg;base64,' + c.afterImageB64 })) : '',
    c.rating ? h('p', {}, 'تقييم المواطن: ' + '⭐'.repeat(c.rating)) : '',
    timeline(c),
    priorityPicker(c),
    c.aiSummary ? h('p', { class: 'ai' }, '🤖 ' + c.aiSummary) : '',
    (c.repairable === true || c.repairable === false) ? h('div', { class: c.repairable ? 'rep yes' : 'rep no' },
      h('b', {}, c.repairable ? '✅ تقرير الموظف: ممكن صيانتها' : '❌ تقرير الموظف: غير ممكن صيانتها'),
      c.branch ? h('div', {}, 'الفرع: ' + c.branch) : '',
      (c.repairable && c.materials) ? h('div', {}, 'المواد المطلوبة: ' + c.materials) : '') : '',
    c.reply ? h('p', { class: 'reply' }, 'رد الموظف: ' + c.reply) : '',
    c.status === 'new' ? h('button', { class: 'act', onclick: () => window.api.analyze(c.id) }, 'تحليل وتوجيه الآن') : '',
    logButton(c.id)
  );
}

function renderSettings() {
  const provider = h('select', {},
    h('option', { value: 'claude' }, 'Claude (يحتاج مفتاح API ورصيد)'),
    h('option', { value: 'local' }, 'محلي Ollama (مجاني، بدون إنترنت)'),
    h('option', { value: 'hybrid' }, 'هجين: المحلي أولاً ثم Claude عند الشك أو الفشل'));
  provider.value = settings.provider || 'claude';
  const ollamaUrl = h('input', { type: 'text', value: settings.ollamaUrl || 'http://localhost:11434' });
  const ollamaModel = h('input', { type: 'text', value: settings.ollamaModel || '', placeholder: 'الاسم كما يظهر في الأمر ollama list' });
  const localImages = h('input', { type: 'checkbox', checked: !!settings.localImages });
  const rules = h('textarea', { value: settings.rules || '', rows: 8, placeholder: 'اكتب هنا قواعد التوجيه، مثلاً: كسر الشارع والحفر → البلدية' });
  const key = h('input', { type: 'password', value: settings.apiKey || '' });
  const model = h('input', { type: 'text', value: settings.model || '' });
  const depts = h('textarea', { value: (settings.departments || []).join('\n') });
  const auto = h('input', { type: 'checkbox', checked: !!settings.auto });
  const path = h('span', {}, settings.serviceAccountPath || 'لم يُحدد بعد');
  return [
    h('div', { class: 'card' },
      h('label', {}, 'طريقة التحليل'), provider,
      h('label', {}, 'مفتاح Claude API (للوضعين Claude والهجين)'), key,
      h('label', {}, 'اسم النموذج'), model,
      h('label', {}, 'عنوان Ollama'), ollamaUrl,
      h('label', {}, 'اسم نموذج Ollama'), ollamaModel,
      h('label', {}, localImages, ' النموذج المحلي يدعم الصور (فعّلها فقط لنموذج يفهم الصور)'),
      h('button', { class: 'act', onclick: () => window.api.testOllama() }, 'فحص اتصال Ollama'),
      h('label', {}, 'تعليمات التوجيه (اشرح للنموذج أي شكوى تذهب لأي قسم)'), rules,
      h('label', {}, 'الأقسام (قسم في كل سطر — يجب أن تطابق أقسام الموظفين تماماً)'), depts,
      h('label', {}, auto, ' التحليل والتوجيه التلقائي للشكاوى الجديدة'),
      h('label', {}, 'مفتاح حساب خدمة Firebase (JSON)'),
      h('button', { class: 'act', onclick: async () => { const p = await window.api.pickKey(); settings.serviceAccountPath = p; path.textContent = p || 'لم يُحدد بعد'; } }, 'اختيار الملف'), ' ', path,
      h('p', {}),
      h('button', {
        class: 'act',
        onclick: async () => {
          settings = {
            ...settings, provider: provider.value, rules: rules.value.trim(), ollamaUrl: ollamaUrl.value.trim(), ollamaModel: ollamaModel.value.trim(), localImages: localImages.checked,
            apiKey: key.value.trim(), model: model.value.trim(), auto: auto.checked,
            departments: depts.value.split('\n').map((s) => s.trim()).filter(Boolean),
          };
          await window.api.setSettings(settings);
          await window.api.connect();
        },
      }, 'حفظ وإعادة الاتصال'))
  ];
}

function branchStats() {
  const depts = (settings.departments && settings.departments.length)
    ? settings.departments
    : [...new Set(list.map((c) => c.department).filter(Boolean))];
  return depts.map((dept) => {
    const names = new Set();
    staff.filter((s) => s.departments.includes(dept)).forEach((s) => s.branches.forEach((b) => names.add(b)));
    const inDept = list.filter((c) => c.department === dept && c.status !== 'new');
    inDept.forEach((c) => { if (c.branch) names.add(c.branch); });
    const rows = [...names].map((b) => {
      const cs = inDept.filter((c) => c.branch === b);
      const open = cs.filter((c) => c.status !== 'resolved').length;
      return {
        branch: b, total: cs.length, open, done: cs.length - open,
        can: cs.filter((c) => c.repairable === true).length,
        cant: cs.filter((c) => c.repairable === false).length,
      };
    });
    const nb = inDept.filter((c) => !c.branch);
    return { dept, rows, noBranchTotal: nb.length, noBranchOpen: nb.filter((c) => c.status !== 'resolved').length };
  }).filter((d) => d.rows.length || d.noBranchTotal);
}

function crewStats() {
  const depts = (settings.departments && settings.departments.length)
    ? settings.departments
    : [...new Set(list.map((c) => c.department).filter(Boolean))];
  return depts.map((dept) => {
    const names = new Set();
    staff.filter((s) => s.departments.includes(dept)).forEach((s) => (s.crews || []).forEach((k) => names.add(k)));
    const inDept = list.filter((c) => c.department === dept && c.status !== 'new');
    inDept.forEach((c) => { if (c.crew) names.add(c.crew); });
    const rows = [...names].map((k) => {
      const cs = inDept.filter((c) => c.crew === k);
      const open = cs.filter((c) => c.status !== 'resolved').length;
      const rs = cs.filter((c) => c.rating > 0);
      const dn = cs.filter((c) => c.resolvedMs);
      const avgT = dn.length ? fmtD(dn.reduce((a, c) => a + (c.resolvedMs - workStart(c)), 0) / dn.length) : '-';
      return { crew: k, total: cs.length, open, done: cs.length - open, avgT, avg: rs.length ? (rs.reduce((a, c) => a + c.rating, 0) / rs.length).toFixed(1) + ' (' + rs.length + ')' : '-' };
    });
    const un = inDept.filter((c) => !c.crew && c.status !== 'resolved').length;
    const allR = inDept.filter((c) => c.rating > 0);
    const deptAvg = allR.length ? (allR.reduce((a, c) => a + c.rating, 0) / allR.length).toFixed(1) + ' من 5 (' + allR.length + ' تقييم)' : 'لا تقييمات بعد';
    return { dept, rows, unassigned: un, deptAvg };
  }).filter((d) => d.rows.length);
}

function renderCrews() {
  return crewStats().map((d) => {
    const busy = d.rows.filter((r) => r.open > 0).length;
    return h('div', { class: 'card' },
      h('h3', {}, 'كوادر الصيانة — ' + d.dept),
      h('div', { class: 'sum' },
        h('span', { class: 'chip' }, 'عدد الكوادر: ' + d.rows.length),
        h('span', { class: 'chip warn' }, 'كوادر مشغولة: ' + busy),
        h('span', { class: 'chip ok' }, 'كوادر متاحة: ' + (d.rows.length - busy)),
        h('span', { class: 'chip' }, 'شكاوى غير مُسندة: ' + d.unassigned),
        h('span', { class: 'chip' }, '⭐ تقييم القسم: ' + d.deptAvg)),
      h('table', {},
        h('tr', {}, ...['الكادر', 'المُسند إليه', 'المتبقي', 'المنجز', 'متوسط زمن الإنجاز', 'التقييم'].map((x) => h('th', {}, x))),
        ...d.rows.map((r) => h('tr', {},
          h('td', {}, r.crew), h('td', {}, String(r.total)),
          h('td', { class: r.open ? 'warn' : '' }, String(r.open)), h('td', {}, String(r.done)), h('td', {}, r.avgT), h('td', {}, r.avg)))));
  });
}

function renderBusy() {
  const stats = crewStats();
  if (!stats.length) return [h('div', { class: 'empty' }, 'لا توجد كوادر معرّفة بعد (أضف الحقل crews في مستند الموظف)')];
  const now = Date.now();
  const out = [];
  let totalBusy = 0, totalFree = 0;
  const blocks = stats.map((d) => {
    const busy = [], free = [];
    d.rows.forEach((r) => {
      const jobs = list.filter((c) => c.department === d.dept && c.crew === r.crew && c.status !== 'resolved' && c.status !== 'new');
      (jobs.length ? busy : free).push({ crew: r.crew, jobs });
    });
    busy.sort((a, b) => b.jobs.length - a.jobs.length);
    totalBusy += busy.length; totalFree += free.length;
    return { dept: d.dept, busy, free };
  });
  out.push(h('div', { class: 'card' },
    h('h3', {}, 'حالة الكوادر الآن'),
    h('div', { class: 'sum' },
      h('span', { class: 'chip warn' }, '🔴 مشغولة: ' + totalBusy),
      h('span', { class: 'chip ok' }, '🟢 متاحة: ' + totalFree))));
  blocks.forEach((b) => {
    out.push(h('div', { class: 'card' },
      h('h3', {}, b.dept),
      b.free.length ? h('div', { class: 'sum' }, h('b', {}, 'متاحة: '), ...b.free.map((f) => h('span', { class: 'chip ok' }, '🟢 ' + f.crew))) : '',
      !b.busy.length ? h('p', { class: 'small' }, 'لا توجد كوادر مشغولة في هذا القسم') : ''));
    b.busy.forEach((k) => {
      out.push(h('div', { class: 'card' },
        h('h3', {}, '🚧 ' + k.crew + ' — مشغول (' + k.jobs.length + ' ' + (k.jobs.length === 1 ? 'عمل' : 'أعمال') + ') • ' + b.dept),
        ...k.jobs.map((c) => {
          const since = c.crewMs || c.startedMs || c.routedMs || c.createdMs;
          return h('div', { class: c.priority === 'urgent' ? 'rep no' : 'rep yes' },
            h('b', {}, (c.priority === 'urgent' ? '🚨 ' : '') + c.title),
            h('div', { class: 'small' }, 'الأولوية: ' + (PRI[c.priority] || '-') + (c.branch ? ' • الفرع: ' + c.branch : '')),
            since ? h('div', { class: 'small' }, 'استلمها: ' + fmtT(since) + ' • مضى: ' + fmtD(now - since)) : '',
            c.lat !== null ? h('button', { class: 'act', onclick: () => window.api.openMap(c.lat, c.lng) }, '📍 الموقع على الخريطة') : '');
        })));
    });
  });
  return out;
}

function renderReport() {
  const stats = branchStats();
  const crewCards = renderCrews();
  if (!stats.length && !crewCards.length) return [h('div', { class: 'empty' }, 'لا توجد بيانات بعد')];
  return [...stats.map((d) => {
    const working = d.rows.filter((r) => r.open > 0).length;
    const finished = d.rows.filter((r) => r.total > 0 && r.open === 0).length;
    const idle = d.rows.filter((r) => r.total === 0).length;
    return h('div', { class: 'card' },
      h('h3', {}, d.dept),
      h('div', { class: 'sum' },
        h('span', { class: 'chip' }, 'عدد الفروع: ' + d.rows.length),
        h('span', { class: 'chip warn' }, 'فروع لديها عمل متبقٍ: ' + working),
        h('span', { class: 'chip ok' }, 'فروع أنجزت كل شكاواها: ' + finished),
        h('span', { class: 'chip' }, 'فروع بلا شكاوى: ' + idle)),
      d.rows.length ? h('table', {},
        h('tr', {}, ...['الفرع', 'الشكاوى', 'المتبقي', 'المنجز', 'ممكن صيانتها', 'غير ممكن'].map((x) => h('th', {}, x))),
        ...d.rows.map((r) => h('tr', {},
          h('td', {}, r.branch), h('td', {}, String(r.total)),
          h('td', { class: r.open ? 'warn' : '' }, String(r.open)),
          h('td', {}, String(r.done)), h('td', {}, String(r.can)), h('td', {}, String(r.cant))))) : '',
      d.noBranchTotal ? h('p', { class: 'small' }, 'شكاوى لم يُحدَّد لها فرع: ' + d.noBranchTotal + ' (المتبقي منها ' + d.noBranchOpen + ')') : '');
  }), ...crewCards];
}

let draft = { title: '', text: '', name: '', phone: '', department: '', priority: 'medium', imageB64: '' };

function renderManual() {
  const inp = (key, ph) => h('input', { type: 'text', value: draft[key], placeholder: ph, oninput: (e) => { draft[key] = e.target.value; } });
  const text = h('textarea', { value: draft.text, placeholder: 'تفاصيل الشكوى كما ذكرها المواطن', oninput: (e) => { draft.text = e.target.value; } });
  const dept = h('select', { onchange: (e) => { draft.department = e.target.value; } },
    h('option', { value: '' }, 'تحليل وتوجيه تلقائي'),
    ...(settings.departments || []).map((d) => h('option', { value: d }, d)));
  dept.value = draft.department;
  const pri = h('select', { onchange: (e) => { draft.priority = e.target.value; } },
    ...Object.entries(PRI).map(([k, v]) => h('option', { value: k }, v)));
  pri.value = draft.priority;
  const preview = h('img', { src: draft.imageB64 ? 'data:image/jpeg;base64,' + draft.imageB64 : '' });
  preview.hidden = !draft.imageB64;
  return [h('div', { class: 'card' },
    h('h3', {}, 'إدخال شكوى يدوياً'),
    h('label', {}, 'عنوان الشكوى'), inp('title', 'مثال: حفرة في الشارع'),
    h('label', {}, 'تفاصيل الشكوى'), text,
    h('label', {}, 'اسم المواطن (اختياري)'), inp('name', ''),
    h('label', {}, 'رقم الهاتف (اختياري)'), inp('phone', ''),
    h('label', {}, 'القسم'), dept,
    h('label', {}, 'الأولوية (تُستعمل عند اختيار قسم يدوياً)'), pri,
    h('label', {}, 'صورة (اختيارية)'),
    h('button', { class: 'act', onclick: async () => {
      const b = await window.api.pickImage();
      if (b) { draft.imageB64 = b; preview.src = 'data:image/jpeg;base64,' + b; preview.hidden = false; }
    } }, 'اختيار صورة'),
    h('button', { class: 'act', onclick: () => { draft.imageB64 = ''; preview.hidden = true; } }, 'إزالة الصورة'),
    preview,
    h('div', {}, h('button', { class: 'act', onclick: async () => {
      const r = await window.api.addComplaint(draft);
      if (r.ok) {
        draft = { title: '', text: '', name: '', phone: '', department: '', priority: 'medium', imageB64: '' };
        render();
      } else {
        document.getElementById('log').textContent = r.error;
      }
    } }, 'حفظ الشكوى')))];
}

function render() {
  const v = document.getElementById('view');
  v.replaceChildren();
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
  if (tab === 'settings') return v.append(...renderSettings());
  if (tab === 'report') return v.append(...renderReport());
  if (tab === 'crews') return v.append(...renderBusy());
  if (tab === 'manual') return v.append(...renderManual());
  const items = list.filter((c) => (tab === 'new' ? c.status === 'new' : c.status !== 'new'));
  if (!items.length) return v.append(h('div', { class: 'empty' }, 'لا توجد شكاوى'));
  // الأكثر إلحاحاً أولاً (ما لم تُحل)، ثم الأحدث
  const rank = (c) => (c.status === 'resolved' ? 9 : (PRI_RANK[c.priority] ?? 4));
  items.sort((a, b) => rank(a) - rank(b) || b.createdMs - a.createdMs);
  v.append(...items.map(card));
}

document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.t; render(); }));
window.api.onComplaints((d) => { list = d; if (tab !== 'settings' && tab !== 'manual') render(); });
window.api.onStaff((d) => { staff = d; if (tab === 'report' || tab === 'crews') render(); });
setInterval(() => { if (tab === 'crews') render(); }, 60000);
window.api.onLog((m) => { document.getElementById('log').textContent = m; });
window.api.getSettings().then((s) => { settings = s; render(); });
