(function () {
  let global = window;
  let qbe = global.GRS1TabulatorQbe || {};

  function normalizeText(value) {
    return String(value == null ? '' : value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  function parseAtomicExpression(rawValue) {
    let input = String(rawValue || '').trim();
    if (!input) return null;

    // Soporte ergonomico: "texto$" equivale a "$texto" (termina en)
    if (input.length > 1 && input.slice(-1) === '$' && input.slice(0, 1) !== '$') {
      return { type: 'atom', op: '$', value: input.slice(0, -1).trim() };
    }

    let twoCharOp = input.slice(0, 2);
    let oneCharOp = input.slice(0, 1);

    if (twoCharOp === '>=' || twoCharOp === '<=' || twoCharOp === '!=') {
      return { type: 'atom', op: twoCharOp, value: input.slice(2).trim() };
    }

    if (
      oneCharOp === '=' ||
      oneCharOp === '>' ||
      oneCharOp === '<' ||
      oneCharOp === '^' ||
      oneCharOp === '$' ||
      oneCharOp === '*' ||
      oneCharOp === '~' ||
      oneCharOp === '!'
    ) {
      return { type: 'atom', op: oneCharOp, value: input.slice(1).trim() };
    }

    return { type: 'atom', op: 'contains', value: input };
  }

  function buildLogicalNode(type, items) {
    let filtered = (items || []).filter(Boolean);
    if (!filtered.length) return null;
    if (filtered.length === 1) return filtered[0];
    return { type: type, items: filtered };
  }

  function parseAndGroup(rawValue) {
    let input = String(rawValue || '').trim();
    if (!input) return null;
    let andParts = input
      .split(/\s*(?:&&|\bAND\b)\s*/i)
      .map(function (part) {
        return String(part || '').trim();
      })
      .filter(Boolean);

    return buildLogicalNode(
      'and',
      andParts.map(function (part) {
        return parseAtomicExpression(part);
      })
    );
  }

  function parseLogicalExpression(rawValue) {
    let input = String(rawValue || '').trim();
    if (!input) return null;

    let orParts = input
      .split(/\s*(?:\|\||\bOR\b)\s*/i)
      .map(function (part) {
        return String(part || '').trim();
      })
      .filter(Boolean);

    return buildLogicalNode(
      'or',
      orParts.map(function (part) {
        return parseAndGroup(part);
      })
    );
  }

  function evaluateExpressionTree(rowValue, expression, atomMatcher) {
    if (!expression) return true;
    if (typeof atomMatcher !== 'function') return true;

    let node = expression;
    if (!node.type && Object.prototype.hasOwnProperty.call(node, 'op')) {
      node = { type: 'atom', op: node.op, value: node.value };
    }

    if (node.type === 'atom') return atomMatcher(rowValue, node);
    if (node.type === 'and') {
      return (node.items || []).every(function (item) {
        return evaluateExpressionTree(rowValue, item, atomMatcher);
      });
    }
    if (node.type === 'or') {
      return (node.items || []).some(function (item) {
        return evaluateExpressionTree(rowValue, item, atomMatcher);
      });
    }

    return true;
  }

  function matchTextAtom(rowValue, expression, normalizeFn) {
    if (!expression || !expression.value) return true;
    let norm = typeof normalizeFn === 'function' ? normalizeFn : normalizeText;
    let left = norm(String(rowValue == null ? '' : rowValue));
    let right = norm(expression.value);
    if (!right) return true;

    if (expression.op === '=') return left === right;
    if (expression.op === '!=') return left !== right;
    if (expression.op === '^') return left.indexOf(right) === 0;
    if (expression.op === '$')
      return left.lastIndexOf(right) === left.length - right.length;
    if (expression.op === '!') return left.indexOf(right) === -1;
    if (expression.op === '*') return left.indexOf(right) !== -1;
    return left.indexOf(right) !== -1;
  }

  function matchNumberAtom(rowValue, expression) {
    if (!expression || !expression.value) return true;
    let left = Number(rowValue);
    let right = Number(expression.value);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;

    if (expression.op === '=') return left === right;
    if (expression.op === '!=') return left !== right;
    if (expression.op === '>') return left > right;
    if (expression.op === '>=') return left >= right;
    if (expression.op === '<') return left < right;
    if (expression.op === '<=') return left <= right;
    return String(left).indexOf(String(right)) !== -1;
  }

  function matchesText(rowValue, expression, normalizeFn) {
    return evaluateExpressionTree(rowValue, expression, function (value, atom) {
      return matchTextAtom(value, atom, normalizeFn);
    });
  }

  function matchesNumber(rowValue, expression) {
    return evaluateExpressionTree(rowValue, expression, matchNumberAtom);
  }

  function ensureBootstrapTooltip(el) {
    if (!global.bootstrap || !bootstrap.Tooltip || !el) return;
    let current = bootstrap.Tooltip.getInstance(el);
    if (current) return;
    bootstrap.Tooltip.getOrCreateInstance(el, {
      container: 'body',
      trigger: 'hover focus',
      placement: 'top',
      boundary: document.body,
    });
  }

  function attachHeaderHelp(options) {
    let cfg = options || {};
    let container = cfg.container;
    let table = cfg.table;
    if (!container || !table || typeof table.getColumns !== 'function') return;

    let headerEl = container.querySelector('.tabulator-header');
    if (!headerEl) return;

    let helpClass = String(cfg.helpClass || 'qbe-help').trim();
    let helpId = String(cfg.helpId || '').trim();
    let insertMode = String(cfg.insertMode || 'before-header').trim();
    let helpSelector = helpId
      ? '#' + helpId
      : '.' + String(helpClass.split(/\s+/)[0] || 'qbe-help');

    if (cfg.helpHtml && !container.querySelector(helpSelector)) {
      let helpEl = document.createElement('div');
      if (helpId) helpEl.id = helpId;
      helpEl.className = helpClass;
      helpEl.innerHTML = cfg.helpHtml;
      if (insertMode === 'inside-header') {
        headerEl.insertBefore(helpEl, headerEl.firstChild || null);
      } else if (insertMode === 'after-header') {
        container.insertBefore(helpEl, headerEl.nextSibling || null);
      } else {
        container.insertBefore(helpEl, headerEl);
      }
    }

    let fieldHelpMap = cfg.fieldHelpMap || {};
    table.getColumns().forEach(function (col) {
      if (
        !col ||
        typeof col.getField !== 'function' ||
        typeof col.getElement !== 'function'
      )
        return;
      let field = col.getField();
      let help = fieldHelpMap[field];
      if (!help) return;
      let colEl = col.getElement();
      if (!colEl || !colEl.querySelector) return;

      let filterInput = colEl.querySelector(
        '.tabulator-header-filter input, .tabulator-header-filter select, .tabulator-header-filter textarea'
      );
      if (!filterInput) return;

      filterInput.setAttribute('title', help);
      filterInput.setAttribute('data-bs-title', help);
      filterInput.setAttribute('data-bs-toggle', 'tooltip');
      ensureBootstrapTooltip(filterInput);
    });
  }

  qbe.normalizeText = normalizeText;
  qbe.parseAtomicExpression = parseAtomicExpression;
  qbe.parseLogicalExpression = parseLogicalExpression;
  qbe.parseExpression = parseLogicalExpression;
  qbe.evaluateExpressionTree = evaluateExpressionTree;
  qbe.matchTextAtom = matchTextAtom;
  qbe.matchNumberAtom = matchNumberAtom;
  qbe.matchesText = matchesText;
  qbe.matchesNumber = matchesNumber;
  qbe.attachHeaderHelp = attachHeaderHelp;

  global.GRS1TabulatorQbe = qbe;
})();
