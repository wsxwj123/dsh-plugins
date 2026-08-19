// 约 20 行的 fake React：记录 createElement 树，供 §3.11 P7 的节点数断言使用。
// 只实现 createElement / useState / useEffect —— INTERFACE §3.9 声明面板只用这三个。

export function createFakeReact() {
  const hooks = [];
  let cursor = 0;
  let onRender = null;
  const react = {
    createElement(type, props, ...children) {
      const flat = children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false);
      return { type, props: props || {}, children: flat };
    },
    useState(init) {
      const i = cursor++;
      if (hooks.length <= i) hooks[i] = typeof init === 'function' ? init() : init;
      return [hooks[i], (next) => {
        hooks[i] = typeof next === 'function' ? next(hooks[i]) : next;
        if (onRender) onRender();
      }];
    },
    useEffect(fn) { const i = cursor++; if (!hooks[i]) { hooks[i] = true; fn(); } },
  };
  return {
    react,
    /** 渲染一个组件引用（禁止直接调用 Panel()，见 §3.9 边界约束 2） */
    render(Component, props = {}) {
      cursor = 0;
      return Component(props);
    },
    setRerenderHook(fn) { onRender = fn; },
    reset() { hooks.length = 0; cursor = 0; },
  };
}

/**
 * 把 createElement 树摊平成节点数组（不含纯文本子节点）。
 * 函数型 type（组件）会被就地展开：既保留组件节点本身（这是"经 createElement 挂载"的证据，
 * 见 INTERFACE §3.9 边界约束 2），也把它的渲染结果并入树。
 */
export function flattenTree(node, out = [], depth = 0) {
  if (!node || typeof node !== 'object' || depth > 50) return out;
  if (Array.isArray(node)) { for (const n of node) flattenTree(n, out, depth + 1); return out; }
  out.push(node);
  if (typeof node.type === 'function') {
    flattenTree(node.type({ ...node.props, children: node.children }), out, depth + 1);
  }
  for (const c of node.children || []) flattenTree(c, out, depth + 1);
  return out;
}

/** 节点数（§3.11 P7 的计数口径：元素节点，不计文本） */
export function countNodes(node) {
  return flattenTree(node).length;
}

/** 收集整棵树里的文本，用于文案断言（组件节点会被展开） */
export function textOf(node, depth = 0) {
  if (node === null || node === undefined || node === false || depth > 50) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map((n) => textOf(n, depth + 1)).join('');
  if (typeof node !== 'object') return '';
  const own = (node.children || []).map((n) => textOf(n, depth + 1)).join('');
  if (typeof node.type === 'function') {
    return own + textOf(node.type({ ...node.props, children: node.children }), depth + 1);
  }
  return own;
}

/** 树里是否存在以某个函数组件为 type 的节点 —— 证明它是经 createElement 挂载的 */
export function hasComponentNode(node, Component) {
  return flattenTree(node).some((n) => n.type === Component);
}

/** 树里是否存在带某 className 的节点（className 可以是空格分隔的多类） */
export function hasClass(node, cls) {
  return flattenTree(node).some((n) => {
    const c = n.props && n.props.className;
    return typeof c === 'string' && c.split(/\s+/).includes(cls);
  });
}

/** 树里是否存在某种 type 的节点（如 'textarea'） */
export function hasType(node, type) {
  return flattenTree(node).some((n) => n.type === type);
}

/** 按可见文案找可点节点（e2e 用文案选择器，单测这里等价） */
export function findByText(node, text) {
  return flattenTree(node).find((n) => textOf(n) === text || textOf(n).includes(text));
}
