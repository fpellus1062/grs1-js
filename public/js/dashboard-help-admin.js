// @ts-nocheck
(function () {
  const app = window.GRS1Dashboard;
  const API = '/api/help';

  let _allItems = [];
  let _editModal = null;
  let _deleteModal = null;
  let _previewModal = null;
  let _pendingDeleteId = null;
  let _bound = false;
  let _helpEditor = null;
  let _rawToolLoadPromise = null;

  // ── Helpers UI ──────────────────────────────────────────────────────────────

  function showAlert(msg, type = 'danger') {
    const zone = document.getElementById('helpAdminAlertZone');
    if (!zone) return;
    zone.innerHTML = `<div class="alert alert-${type} alert-dismissible py-2 px-3 mb-2" style="font-size:.82rem" role="alert">
      ${msg}
      <button type="button" class="btn-close btn-sm" data-bs-dismiss="alert"></button>
    </div>`;
  }

  function clearAlert() {
    const zone = document.getElementById('helpAdminAlertZone');
    if (zone) zone.innerHTML = '';
  }

  function showFormError(msg) {
    const el = document.getElementById('helpAdminFormError');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('d-none');
  }

  function clearFormError() {
    const el = document.getElementById('helpAdminFormError');
    if (el) el.classList.add('d-none');
  }

  function sanitizeHelpHtml(html) {
    if (typeof DOMPurify !== 'undefined') {
      return DOMPurify.sanitize(html, {
        ALLOWED_TAGS: [
          'div',
          'p',
          'br',
          'b',
          'strong',
          'i',
          'em',
          'u',
          's',
          'ul',
          'ol',
          'li',
          'table',
          'thead',
          'tbody',
          'tr',
          'th',
          'td',
          'a',
          'img',
          'figure',
          'figcaption',
          'input',
          'code',
          'pre',
          'h1',
          'h2',
          'h3',
          'h4',
          'h5',
          'h6',
          'hr',
          'blockquote',
          'span',
        ],
        ALLOWED_ATTR: [
          'href',
          'target',
          'rel',
          'class',
          'style',
          'src',
          'alt',
          'title',
          'type',
          'checked',
          'disabled',
          'loading',
          'width',
          'height',
        ],
        FORCE_BODY: true,
      });
    }
    const d = document.createElement('div');
    d.textContent = html;
    return d.innerHTML;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Convierte HTML legacy a bloques EditorJS.
   * Permite migrar automáticamente contenidos HTML al abrirlos en el editor.
   */
  function htmlToEditorBlocks(html) {
    const doc = new DOMParser().parseFromString(
      `<body>${html}</body>`,
      'text/html'
    );
    const body = doc.body;
    const blocks = [];

    function processNode(node) {
      const tag = node.nodeName.toLowerCase();

      if (/^h[1-6]$/.test(tag)) {
        const level = parseInt(tag[1], 10);
        const text = node.innerHTML.trim();
        if (text) blocks.push({ type: 'header', data: { level, text } });
        return;
      }

      if (tag === 'p') {
        const text = node.innerHTML.trim();
        if (text) blocks.push({ type: 'paragraph', data: { text } });
        return;
      }

      if (tag === 'ul' || tag === 'ol') {
        const style = tag === 'ol' ? 'ordered' : 'unordered';
        const items = Array.from(node.querySelectorAll(':scope > li')).map(
          (li) => ({ content: li.innerHTML.trim(), items: [], meta: {} })
        );
        if (items.length) blocks.push({ type: 'list', data: { style, items } });
        return;
      }

      if (tag === 'pre') {
        const codeEl = node.querySelector('code');
        const code = codeEl ? codeEl.textContent : node.textContent;
        if (code.trim())
          blocks.push({ type: 'code', data: { code: code.trim() } });
        return;
      }

      if (tag === 'hr') {
        // 'delimiter' no está registrado en EditorJS tools — se omite para no
        // romper editor.render(). Se renderiza como <hr> solo en la salida HTML.
        return;
      }

      if (tag === 'blockquote') {
        const text = node.innerHTML.trim();
        if (text)
          blocks.push({ type: 'paragraph', data: { text: `<i>${text}</i>` } });
        return;
      }

      if (
        [
          'div',
          'section',
          'article',
          'main',
          'aside',
          'nav',
          'figure',
          'header',
          'footer',
        ].includes(tag)
      ) {
        const blockChildren = Array.from(node.children).filter((c) => {
          const ct = c.nodeName.toLowerCase();
          return (
            /^h[1-6]$/.test(ct) ||
            [
              'p',
              'ul',
              'ol',
              'pre',
              'hr',
              'div',
              'section',
              'article',
              'blockquote',
            ].includes(ct)
          );
        });
        if (blockChildren.length > 0) {
          blockChildren.forEach((child) => processNode(child));
        } else {
          const text = node.innerHTML.trim();
          if (text) blocks.push({ type: 'paragraph', data: { text } });
        }
        return;
      }

      // fallback: texto plano como párrafo
      const text = node.textContent.trim();
      if (text)
        blocks.push({ type: 'paragraph', data: { text: escapeHtml(text) } });
    }

    Array.from(body.childNodes).forEach((node) => {
      if (node.nodeType === 3) {
        const text = node.textContent.trim();
        if (text)
          blocks.push({ type: 'paragraph', data: { text: escapeHtml(text) } });
      } else if (node.nodeType === 1) {
        processNode(node);
      }
    });

    if (blocks.length === 0) {
      blocks.push({ type: 'paragraph', data: { text: '' } });
    }

    return { time: Date.now(), blocks, version: '2.28.2' };
  }

  function tryParseEditorData(content) {
    if (typeof content !== 'string') return null;
    const raw = content.trim();
    if (!raw.startsWith('{')) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.blocks)) return parsed;
      return null;
    } catch {
      return null;
    }
  }

  function renderEditorBlocksToHtml(editorData) {
    if (!editorData || !Array.isArray(editorData.blocks)) return '';

    const renderListItems = (items = [], style = 'unordered') => {
      const isOrdered = style === 'ordered';
      const tag = isOrdered ? 'ol' : 'ul';
      const content = items
        .map((it) => {
          // Usar content directamente — puede contener HTML inline (bold, italic…)
          const text =
            typeof it === 'string'
              ? escapeHtml(it)
              : (it?.content ?? it?.text ?? '');
          const nested =
            Array.isArray(it?.items) && it.items.length
              ? renderListItems(it.items, style)
              : '';
          return `<li>${text}${nested}</li>`;
        })
        .join('');
      return `<${tag}>${content}</${tag}>`;
    };

    return editorData.blocks
      .map((block) => {
        const type = block?.type;
        const data = block?.data || {};

        if (type === 'paragraph') {
          return `<p>${data.text || ''}</p>`;
        }

        if (type === 'header') {
          const level = Math.min(6, Math.max(1, Number(data.level) || 2));
          return `<h${level}>${data.text || ''}</h${level}>`;
        }

        if (type === 'list') {
          return renderListItems(data.items || [], data.style || 'unordered');
        }

        if (type === 'checklist') {
          const items = Array.isArray(data.items) ? data.items : [];
          return `<ul>${items
            .map((it) => {
              const checked =
                it?.meta?.checked || it?.checked ? ' checked' : '';
              const text = escapeHtml(it?.text || it?.content || '');
              return `<li><input type="checkbox" disabled${checked}> ${text}</li>`;
            })
            .join('')}</ul>`;
        }

        if (type === 'code') {
          return `<pre><code>${escapeHtml(data.code || '')}</code></pre>`;
        }

        if (type === 'delimiter') {
          return '<hr>';
        }

        if (type === 'image') {
          const src = data?.file?.url || '';
          if (!src) return '';
          const caption = data.caption
            ? `<figcaption>${data.caption}</figcaption>`
            : '';
          return `<figure><img src="${escapeHtml(src)}" alt="">${caption}</figure>`;
        }

        if (type === 'raw') {
          return data.html || '';
        }

        return '';
      })
      .join('');
  }

  function contentToPreviewHtml(content) {
    const parsed = tryParseEditorData(content);
    if (parsed) {
      const html = renderEditorBlocksToHtml(parsed);
      return sanitizeHelpHtml(
        html || '<p class="text-muted">Sin contenido.</p>'
      );
    }
    return sanitizeHelpHtml(
      content || '<p class="text-muted">Sin contenido.</p>'
    );
  }

  function hasEditorJs() {
    return (
      typeof window.EditorJS !== 'undefined' &&
      typeof window.Header !== 'undefined' &&
      typeof window.EditorjsList !== 'undefined' &&
      typeof window.Checklist !== 'undefined' &&
      typeof window.CodeTool !== 'undefined'
    );
  }

  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded === 'true') return resolve();
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener(
          'error',
          () => reject(new Error(`No se pudo cargar ${src}`)),
          { once: true }
        );
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.addEventListener('load', () => {
        script.dataset.loaded = 'true';
        resolve();
      });
      script.addEventListener('error', () => {
        reject(new Error(`No se pudo cargar ${src}`));
      });
      document.head.appendChild(script);
    });
  }

  async function ensureRawToolLoaded() {
    if (typeof window.RawTool !== 'undefined') return true;
    if (_rawToolLoadPromise) {
      await _rawToolLoadPromise;
      return typeof window.RawTool !== 'undefined';
    }

    _rawToolLoadPromise = (async () => {
      const sources = ['/vendor/editorjs/raw/raw.umd.js'];
      for (const src of sources) {
        try {
          await loadScriptOnce(src);
          if (typeof window.RawTool !== 'undefined') return;
        } catch {
          // En intranet solo se permite carga local.
        }
      }
      throw new Error('RawTool no disponible');
    })();

    try {
      await _rawToolLoadPromise;
    } catch {
      return false;
    }
    return typeof window.RawTool !== 'undefined';
  }

  async function ensureEditor() {
    if (_helpEditor) return _helpEditor;
    if (!hasEditorJs()) return null;

    const holder = document.getElementById('helpAdminEditorHolder');
    if (!holder) return null;

    const rawAvailable = await ensureRawToolLoaded();

    const tools = {
      header: { class: window.Header, inlineToolbar: true },
      list: { class: window.EditorjsList, inlineToolbar: true },
      checklist: { class: window.Checklist, inlineToolbar: true },
      code: { class: window.CodeTool },
    };
    if (rawAvailable && typeof window.RawTool !== 'undefined') {
      tools.raw = { class: window.RawTool };
    } else {
      console.warn(
        '[help-admin] RawTool no disponible; se oculta el bloque raw'
      );
    }

    _helpEditor = new window.EditorJS({
      holder: 'helpAdminEditorHolder',
      autofocus: false,
      placeholder: 'Escribe ayuda por bloques...',
      tools,
      data: {
        blocks: [{ type: 'paragraph', data: { text: '' } }],
      },
    });

    await _helpEditor.isReady;
    return _helpEditor;
  }

  async function setEditorContent(rawContent) {
    const editor = await ensureEditor();
    const hiddenContent = document.getElementById('helpAdminContent');
    const fallback = String(rawContent || '');

    if (hiddenContent) hiddenContent.value = fallback;
    if (!editor) return;

    const parsed = tryParseEditorData(fallback);
    const looksLikeHtml = /<\s*\/?[a-z][^>]*>/i.test(fallback);
    // Si no es JSON EditorJS válido, convertir HTML legacy a bloques
    const data =
      parsed ||
      (fallback.trim()
        ? looksLikeHtml
          ? {
              blocks: [
                {
                  type: 'raw',
                  data: { html: fallback },
                },
              ],
            }
          : htmlToEditorBlocks(fallback)
        : { blocks: [{ type: 'paragraph', data: { text: '' } }] });

    try {
      await editor.render(data);
    } catch (err) {
      console.warn(
        '[help-admin] editor.render falló, usando párrafo de fallback:',
        err?.message || err
      );
      await editor.render({
        blocks: [{ type: 'paragraph', data: { text: fallback || '' } }],
      });
    }
  }

  async function getContentForSave() {
    const hiddenContent = document.getElementById('helpAdminContent');
    const editor = await ensureEditor();

    if (!editor) {
      return hiddenContent?.value?.trim() || '';
    }

    const data = await editor.save();
    const hasContent = Array.isArray(data.blocks)
      ? data.blocks.some((b) => {
          const d = b?.data || {};
          return Object.values(d).some((v) => String(v || '').trim() !== '');
        })
      : false;

    if (!hasContent) return '';

    const serialized = JSON.stringify(data);
    if (hiddenContent) hiddenContent.value = serialized;
    return serialized;
  }

  function invalidateHelpCache() {
    const helpWidget = window.HelpWidget;
    if (
      typeof helpWidget !== 'undefined' &&
      typeof helpWidget.clearCache === 'function'
    ) {
      helpWidget.clearCache();
      return;
    }
    Object.keys(sessionStorage)
      .filter((k) => k.startsWith('help_cache_'))
      .forEach((k) => sessionStorage.removeItem(k));
  }

  // ── Render tabla ─────────────────────────────────────────────────────────────

  function renderTable() {
    const tbody = document.getElementById('helpAdminTableBody');
    const filterType = (
      document.getElementById('helpAdminFilterType')?.value || ''
    ).toLowerCase();
    const filterCtx = (
      document.getElementById('helpAdminFilterContext')?.value || ''
    ).toLowerCase();

    const items = _allItems.filter((it) => {
      if (filterType && it.type !== filterType) return false;
      if (
        filterCtx &&
        !String(it.context || '')
          .toLowerCase()
          .includes(filterCtx)
      )
        return false;
      return true;
    });

    const total = document.getElementById('helpAdminTotal');
    if (total) total.textContent = _allItems.length;

    if (!tbody) return;

    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">Sin resultados</td></tr>`;
      return;
    }

    tbody.innerHTML = items
      .map((it) => {
        const typeBadge =
          it.type === 'tooltip'
            ? window.GRS1Utils.renderSemanticBadgeHtml('tooltip', 'info', {
                variant: 'solid',
                fontSize: '.7rem',
              })
            : window.GRS1Utils.renderSemanticBadgeHtml('modal', 'secondary', {
                variant: 'solid',
                fontSize: '.7rem',
              });
        const title = it.title
          ? it.title.replace(/</g, '&lt;').replace(/>/g, '&gt;')
          : '—';
        const ctx = it.context
          ? it.context.replace(/</g, '&lt;').replace(/>/g, '&gt;')
          : '—';
        return `<tr>
          <td class="text-muted">${it.id}</td>
          <td>${title}</td>
          <td><code style="font-size:.78rem">${ctx}</code></td>
          <td>${typeBadge}</td>
          <td class="text-end pe-3">
            <button class="btn btn-outline-secondary btn-sm py-0 px-1 me-1" data-ha-action="edit" data-ha-id="${it.id}" title="Editar"><i class="bi bi-pencil"></i></button>
            <button class="btn btn-outline-danger btn-sm py-0 px-1" data-ha-action="delete" data-ha-id="${it.id}" title="Eliminar"><i class="bi bi-trash3"></i></button>
          </td>
        </tr>`;
      })
      .join('');
  }

  // ── API calls ────────────────────────────────────────────────────────────────

  async function loadData() {
    clearAlert();
    const tbody = document.getElementById('helpAdminTableBody');
    if (tbody)
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">
        <div class="spinner-border spinner-border-sm me-2" role="status"></div>Cargando…</td></tr>`;

    try {
      const res = await fetch(API, { headers: app.getHeaders() });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data = await res.json();
      _allItems = data.result || [];
      renderTable();
    } catch (err) {
      showAlert(`No se pudo cargar la lista de ayuda: ${err.message}`);
    }
  }

  async function saveItem() {
    clearFormError();
    const id = document.getElementById('helpAdminEditId')?.value?.trim();
    const title = document.getElementById('helpAdminTitle')?.value?.trim();
    const context = document.getElementById('helpAdminContext')?.value?.trim();
    const type = document.getElementById('helpAdminType')?.value || 'modal';
    const content = await getContentForSave();

    if (!title || !context || !content) {
      showFormError('Título, contexto y contenido son obligatorios.');
      return;
    }

    const body = { title, context, type, content };
    const url = id ? `${API}/${id}` : API;
    const method = id ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: app.getHeaders(true),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Error ${res.status}`);
      }
      invalidateHelpCache();
      _editModal?.hide();
      await loadData();
      showAlert(
        id ? 'Item actualizado correctamente.' : 'Item creado correctamente.',
        'success'
      );
    } catch (err) {
      showFormError(err.message);
    }
  }

  async function deleteItem() {
    if (!_pendingDeleteId) return;
    try {
      const res = await fetch(`${API}/${_pendingDeleteId}`, {
        method: 'DELETE',
        headers: app.getHeaders(),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      invalidateHelpCache();
      _deleteModal?.hide();
      _pendingDeleteId = null;
      await loadData();
      showAlert('Item eliminado.', 'success');
    } catch (err) {
      showAlert(`No se pudo eliminar: ${err.message}`);
    }
  }

  // ── Apertura de modales ───────────────────────────────────────────────────────

  function openNewModal() {
    clearFormError();
    const editId = document.getElementById('helpAdminEditId');
    const titleInput = document.getElementById('helpAdminTitle');
    const ctxInput = document.getElementById('helpAdminContext');
    const typeSelect = document.getElementById('helpAdminType');
    const modalTitle = document.getElementById('helpAdminModalTitle');

    if (editId) editId.value = '';
    if (titleInput) titleInput.value = '';
    if (ctxInput) ctxInput.value = '';
    if (typeSelect) typeSelect.value = 'modal';
    if (modalTitle) modalTitle.textContent = 'Nuevo item de ayuda';

    setEditorContent('').catch((err) => {
      console.warn(
        '[help-admin] No se pudo inicializar EditorJS en nuevo item:',
        err?.message || err
      );
    });

    _editModal?.show();
  }

  function openEditModal(item) {
    clearFormError();
    const editId = document.getElementById('helpAdminEditId');
    const titleInput = document.getElementById('helpAdminTitle');
    const ctxInput = document.getElementById('helpAdminContext');
    const typeSelect = document.getElementById('helpAdminType');
    const modalTitle = document.getElementById('helpAdminModalTitle');

    if (editId) editId.value = item.id;
    if (titleInput) titleInput.value = item.title || '';
    if (ctxInput) ctxInput.value = item.context || '';
    if (typeSelect) typeSelect.value = item.type || 'modal';
    if (modalTitle) modalTitle.textContent = 'Editar item de ayuda';

    setEditorContent(item.content || '').catch((err) => {
      console.warn(
        '[help-admin] No se pudo cargar contenido en EditorJS:',
        err?.message || err
      );
    });

    _editModal?.show();
  }

  function openDeleteModal(item) {
    _pendingDeleteId = item.id;
    const titleEl = document.getElementById('helpAdminDeleteTitle');
    if (titleEl) titleEl.textContent = `"${item.title || item.id}"`;
    _deleteModal?.show();
  }

  async function openPreviewModal() {
    const title =
      document.getElementById('helpAdminTitle')?.value?.trim() ||
      'Vista previa';
    let content = document.getElementById('helpAdminContent')?.value || '';
    const titleEl = document.getElementById('helpAdminPreviewTitle');
    const bodyEl = document.getElementById('helpAdminPreviewBody');

    if (!bodyEl || !titleEl) return;

    try {
      const fromEditor = await getContentForSave();
      if (fromEditor) content = fromEditor;
    } catch (err) {
      console.warn(
        '[help-admin] Vista previa usando fallback por error en EditorJS:',
        err?.message || err
      );
    }

    titleEl.textContent = title;
    bodyEl.innerHTML = contentToPreviewHtml(content);
    bodyEl.querySelectorAll('a[href]').forEach((a) => {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    });

    _previewModal?.show();
  }

  // ── Bind de eventos ───────────────────────────────────────────────────────────

  function bindEvents() {
    if (_bound) return;
    _bound = true;

    document
      .getElementById('helpAdminBtnNuevo')
      ?.addEventListener('click', openNewModal);
    document
      .getElementById('helpAdminBtnReload')
      ?.addEventListener('click', loadData);
    document
      .getElementById('helpAdminBtnGuardar')
      ?.addEventListener('click', saveItem);
    document
      .getElementById('helpAdminBtnPreview')
      ?.addEventListener('click', openPreviewModal);
    document
      .getElementById('helpAdminBtnConfirmDelete')
      ?.addEventListener('click', deleteItem);

    document
      .getElementById('helpAdminFilterType')
      ?.addEventListener('change', renderTable);
    document
      .getElementById('helpAdminFilterContext')
      ?.addEventListener('input', renderTable);

    // Delegación de clics en tabla
    document
      .getElementById('helpAdminTableBody')
      ?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-ha-action]');
        if (!btn) return;
        const id = Number(btn.dataset.haId);
        const item = _allItems.find((i) => i.id === id);
        if (!item) return;
        if (btn.dataset.haAction === 'edit') openEditModal(item);
        if (btn.dataset.haAction === 'delete') openDeleteModal(item);
      });
  }

  // ── Inicializador (llamado por dashboard-layout.js) ───────────────────────────

  app.initializeHelpAdmin = async function initializeHelpAdmin() {
    // Los modales Bootstrap se inicializan solo la primera vez
    const editModalEl = document.getElementById('helpAdminModal');
    const deleteModalEl = document.getElementById('helpAdminDeleteModal');
    const previewModalEl = document.getElementById('helpAdminPreviewModal');

    if (!editModalEl || !deleteModalEl || !previewModalEl) {
      throw new Error('[help-admin] Modales no encontrados en el DOM');
    }

    _editModal = bootstrap.Modal.getOrCreateInstance(editModalEl);
    _deleteModal = bootstrap.Modal.getOrCreateInstance(deleteModalEl);
    _previewModal = bootstrap.Modal.getOrCreateInstance(previewModalEl);

    // Limpiar form al cerrar
    editModalEl.addEventListener('hidden.bs.modal', () => {
      clearFormError();
      document.getElementById('helpAdminEditId').value = '';
    });

    ensureEditor().catch((err) => {
      console.warn(
        '[help-admin] EditorJS no disponible, se usará fallback de textarea:',
        err?.message || err
      );
    });

    bindEvents();
    await loadData();
  };
})();
