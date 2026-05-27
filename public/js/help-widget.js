/**
 * help-widget.js
 * Widget reutilizable para mostrar ayuda contextualizada en la aplicación.
 *
 * Uso:
 *   import (o include) este script en cualquier página del dashboard.
 *   Añadir botones con data-help-context="<contexto>" en el HTML.
 *   Llamar a HelpWidget.init() cuando el DOM esté listo.
 *
 * Ejemplo HTML:
 *   <button class="help-btn" data-help-context="usuarios-form" type="button">
 *     <i class="bi bi-question-circle"></i>
 *   </button>
 *
 * API utilizada:
 *   GET /api/help/context/:context  → { ok: true, result: [{ id, title, content, type, context }] }
 */

const HelpWidget = (() => {
  const API_BASE = '/api/help/context';
  const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos
  const TOOLTIP_AUTOCLOSE_MS = 5000;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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

        if (type === 'paragraph') return `<p>${data.text || ''}</p>`;

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

        if (type === 'delimiter') return '<hr>';

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
  // --- Cache en sessionStorage ---
  function cacheGet(context) {
    try {
      const raw = sessionStorage.getItem(`help_cache_${context}`);
      if (!raw) return null;
      const { ts, data } = JSON.parse(raw);
      if (Date.now() - ts > CACHE_TTL_MS) {
        sessionStorage.removeItem(`help_cache_${context}`);
        return null;
      }
      return data;
    } catch {
      return null;
    }
  }

  function cacheSet(context, data) {
    try {
      sessionStorage.setItem(
        `help_cache_${context}`,
        JSON.stringify({ ts: Date.now(), data })
      );
    } catch {
      // sessionStorage lleno — ignorar
    }
  }

  // --- Fetch de help items por contexto ---
  async function fetchHelp(context) {
    const cached = cacheGet(context);
    if (cached) return cached;

    const res = await fetch(`${API_BASE}/${encodeURIComponent(context)}`);
    if (!res.ok) throw new Error(`Error ${res.status} al cargar ayuda`);
    const json = await res.json();
    const data = json.result || [];
    cacheSet(context, data);
    return data;
  }

  // --- Crear / obtener el modal de help ---
  function ensureModal() {
    if (document.getElementById('helpWidgetModal')) return;

    const html = `
      <div class="modal fade" id="helpWidgetModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
          <div class="modal-content shadow">
            <div class="modal-header py-2 px-3">
              <span class="modal-title d-flex align-items-center gap-2" style="font-size:.9rem;font-weight:600">
                <i class="bi bi-question-circle text-secondary"></i>
                <span id="helpWidgetModalTitle">Ayuda</span>
              </span>
              <button type="button" class="btn-close btn-sm" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body px-3 py-3 help-body" id="helpWidgetModalBody" style="min-height:260px">
            </div>
            <div class="modal-footer py-2 px-3">
              <button type="button" class="btn btn-primary btn-sm py-1 px-3" style="font-size:.78rem"
                data-bs-dismiss="modal">Entendido</button>
            </div>
          </div>
        </div>
      </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
  }

  // --- Mostrar modal con contenido de help ---
  function showHelpModal(items) {
    ensureModal();

    const titleEl = document.getElementById('helpWidgetModalTitle');
    const bodyEl = document.getElementById('helpWidgetModalBody');

    // Sanitizador: DOMPurify si está disponible, fallback a textContent
    const sanitize =
      typeof DOMPurify !== 'undefined'
        ? (html) =>
            DOMPurify.sanitize(html, {
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
            })
        : (html) => {
            const d = document.createElement('div');
            d.textContent = html;
            return d.innerHTML;
          };

    if (items.length === 0) {
      titleEl.textContent = 'Ayuda';
      bodyEl.textContent =
        'No hay información de ayuda disponible para este contexto.';
    } else {
      const item = items[0];
      // Título: siempre texto plano
      titleEl.textContent = item.title || 'Ayuda';

      // Contenido: HTML sanitizado
      const parsed = tryParseEditorData(item.content || '');
      const renderedHtml = parsed
        ? renderEditorBlocksToHtml(parsed)
        : item.content || '';
      bodyEl.innerHTML = sanitize(renderedHtml);

      // Los enlaces externos se abren en nueva pestaña de forma segura
      bodyEl.querySelectorAll('a[href]').forEach((a) => {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
      });
    }

    const modal = bootstrap.Modal.getOrCreateInstance(
      document.getElementById('helpWidgetModal')
    );
    modal.show();
  }

  // --- Mostrar tooltip Bootstrap en elemento ---
  function showHelpTooltip(items, triggerEl) {
    if (!triggerEl) return;

    let text = 'Sin información de ayuda disponible.';
    if (items.length > 0) {
      const parsed = tryParseEditorData(items[0].content || '');
      if (parsed && Array.isArray(parsed.blocks)) {
        const firstBlock = parsed.blocks.find((b) => b?.data);
        const firstData = firstBlock?.data || {};
        text =
          firstData.text ||
          firstData.content ||
          firstData.caption ||
          'Ayuda disponible en formato enriquecido.';
      } else {
        text = items[0].content;
      }
    }

    // Destruir tooltip anterior si existe
    const existing = bootstrap.Tooltip.getInstance(triggerEl);
    if (existing) existing.dispose();

    const tt = new bootstrap.Tooltip(triggerEl, {
      title: text,
      trigger: 'manual',
      placement: 'top',
    });
    tt.show();

    // Cierre robusto: blur, mouseleave, Escape, click fuera y timeout.
    let closed = false;
    const closeTooltip = () => {
      if (closed) return;
      closed = true;
      tt.hide();
      tt.dispose();
      triggerEl.removeEventListener('blur', onBlur);
      triggerEl.removeEventListener('mouseleave', onMouseLeave);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('click', onOutsideClick, true);
      window.clearTimeout(autoCloseTimer);
    };

    const onBlur = () => closeTooltip();
    const onMouseLeave = () => closeTooltip();
    const onKeyDown = (e) => {
      if (e.key === 'Escape') closeTooltip();
    };
    const onOutsideClick = (e) => {
      if (!triggerEl.contains(e.target)) closeTooltip();
    };

    triggerEl.addEventListener('blur', onBlur);
    triggerEl.addEventListener('mouseleave', onMouseLeave);
    document.addEventListener('keydown', onKeyDown);

    // Espera un tick para no cerrar por el mismo click que lo abre.
    setTimeout(() => {
      if (!closed) document.addEventListener('click', onOutsideClick, true);
    }, 0);

    const autoCloseTimer = window.setTimeout(
      closeTooltip,
      TOOLTIP_AUTOCLOSE_MS
    );
  }

  // --- Handler principal para click en botones de help ---
  async function handleHelpClick(btn) {
    const context = btn.dataset.helpContext;
    if (!context) return;

    const preferType = btn.dataset.helpType || null; // Forzar tipo si se especifica

    btn.disabled = true;
    try {
      const items = await fetchHelp(context);
      const type = preferType || (items[0]?.type ?? 'modal');

      if (type === 'tooltip') {
        showHelpTooltip(items, btn);
      } else {
        showHelpModal(items);
      }
    } catch (err) {
      console.warn('[HelpWidget] No se pudo cargar la ayuda:', err.message);
      showHelpModal([]);
    } finally {
      btn.disabled = false;
    }
  }

  // --- API pública ---

  /**
   * Inicializa el widget: adjunta listeners a todos los [data-help-context].
   * Puede llamarse al cargar el DOM o tras renderizar contenido dinámico.
   * @param {HTMLElement|Document} root - Nodo raíz donde buscar botones (default: document)
   */
  function init(root = document) {
    ensureModal();
    const btns = root.querySelectorAll('[data-help-context]');
    btns.forEach((btn) => {
      // Evitar doble-binding
      if (btn.dataset.helpWidgetBound) return;
      btn.dataset.helpWidgetBound = '1';
      btn.addEventListener('click', () => handleHelpClick(btn));
    });
  }

  /**
   * Muestra ayuda para un contexto determinado (llamada programática).
   * @param {string} context
   * @param {'tooltip'|'modal'|null} forceType - Forzar tipo de componente
   * @param {HTMLElement|null} anchorEl - Elemento ancla (para tooltip)
   */
  async function showHelp(context, forceType = null, anchorEl = null) {
    try {
      const items = await fetchHelp(context);
      const type = forceType || (items[0]?.type ?? 'modal');
      if (type === 'tooltip' && anchorEl) {
        showHelpTooltip(items, anchorEl);
      } else {
        showHelpModal(items);
      }
    } catch (err) {
      console.warn('[HelpWidget] Error:', err.message);
    }
  }

  /**
   * Limpia la caché de un contexto o de todos los contextos.
   * @param {string|null} context - null para limpiar toda la caché de help
   */
  function clearCache(context = null) {
    if (context) {
      sessionStorage.removeItem(`help_cache_${context}`);
    } else {
      Object.keys(sessionStorage)
        .filter((k) => k.startsWith('help_cache_'))
        .forEach((k) => sessionStorage.removeItem(k));
    }
  }

  return { init, showHelp, clearCache };
})();

window.HelpWidget = HelpWidget;

// El dashboard llama a HelpWidget.init() explícitamente tras loadIncludes().
// No auto-inicializar aquí para evitar ejecutarse antes de que los modales
// dinámicos estén inyectados en el DOM.
