/**
 * A minimal React stand-in, enough to actually execute the widget's render path
 * in Node: elements, the six hooks the component uses, and a tiny renderer.
 *
 * It is deliberately single-pass — no reconciliation, no re-render scheduling —
 * so it can only prove that a render *produces the right tree* and that the hook
 * sequence is stable. That is exactly the class of bug worth catching here: the
 * widget has no interactive state that a single pass cannot express, and a hook
 * behind an early return (the documented way this kind of widget dies) shows up
 * as a changed trace.
 */

/**
 * Flatten nested children arrays.
 * @param values - children.
 * @returns one flat array.
 */
function flatten(values) {
  const out = []
  for (const value of values) {
    if (Array.isArray(value)) out.push(...flatten(value))
    else if (value !== null && value !== undefined && typeof value !== 'boolean') out.push(value)
  }
  return out
}

/**
 * Build a fake React module plus the render harness around it.
 * @returns the React stand-in, a component runner and a tree renderer.
 */
export function createFakeReact() {
  const hookSlots = []
  const hookTrace = []
  let index = 0

  const react = {
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children: flatten(children) }
    },
    useState(initial) {
      const slot = index++
      hookTrace.push('useState')
      if (hookSlots[slot] === undefined) {
        hookSlots[slot] = { value: typeof initial === 'function' ? initial() : initial }
      }
      return [
        hookSlots[slot].value,
        (next) => {
          hookSlots[slot].value = typeof next === 'function' ? next(hookSlots[slot].value) : next
        }
      ]
    },
    useEffect(effect, deps) {
      const slot = index++
      hookTrace.push('useEffect')
      hookSlots[slot] = { effect, deps }
    },
    useMemo(factory, _deps) {
      index += 1
      hookTrace.push('useMemo')
      return factory()
    },
    useCallback(callback) {
      index += 1
      hookTrace.push('useCallback')
      return callback
    },
    useRef(value) {
      const slot = index++
      hookTrace.push('useRef')
      if (hookSlots[slot] === undefined) hookSlots[slot] = { current: value }
      return hookSlots[slot]
    },
    useSyncExternalStore(subscribe, getSnapshot) {
      if (typeof subscribe !== 'function') throw new TypeError('useSyncExternalStore needs a subscribe function')
      index += 1
      hookTrace.push('useSyncExternalStore')
      return getSnapshot()
    }
  }

  /**
   * Run one component as React would, returning both the element and the hook
   * order so a caller can compare traces.
   * @param component - the function component.
   * @param props - its props.
   * @returns `{ element, hooks }`.
   */
  function renderComponent(component, props) {
    index = 0
    hookTrace.length = 0
    const element = component(props)
    return { element, hooks: [...hookTrace] }
  }

  /**
   * Flatten an element tree into its text, invoking function components.
   * @param node - element, text, array or nothing.
   * @returns the concatenated text.
   */
  function toText(node) {
    if (node === null || node === undefined || typeof node === 'boolean') return ''
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map(toText).join('')
    if (typeof node.type === 'function') return toText(node.type({ ...node.props, children: node.children }))
    return node.children.map(toText).join('')
  }

  /**
   * Collect every element in the tree, invoking function components.
   * @param node - element, text, array or nothing.
   * @returns flat element list.
   */
  function toElements(node) {
    if (node === null || node === undefined || typeof node === 'boolean') return []
    if (typeof node === 'string' || typeof node === 'number') return []
    if (Array.isArray(node)) return node.flatMap(toElements)
    if (typeof node.type === 'function') return toElements(node.type({ ...node.props, children: node.children }))
    return [node, ...node.children.flatMap(toElements)]
  }

  /**
   * Set one hook slot before a render, so an expanded state can be exercised.
   * @param slot - hook position.
   * @param value - the state value to plant.
   */
  function setHookState(slot, value) {
    hookSlots[slot] = { value }
  }

  return { react, renderComponent, toText, toElements, setHookState }
}
