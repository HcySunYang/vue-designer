import assert from 'assert'
import { AST } from 'vue-eslint-parser'
import { scopePrefix } from './style'
import { Range } from './modifier'
import { clone } from '../utils'

type RootElement = AST.VElement & AST.HasConcreteInfo
type ChildNode = AST.VElement | AST.VText | AST.VExpressionContainer

export function transformTemplate(body: RootElement, code: string): Template {
  return {
    type: 'Template',
    range: body.range,
    attributes: body.startTag.attributes
      .filter(attr => !attr.directive)
      .map((attr, i) => {
        const a = attr as AST.VAttribute
        return attribute(i, a.key.name, a.value && a.value.value, attr.range)
      }),
    children: body.children.map((child, i) => transformChild(child, code, [i]))
  }
}

function transformElement(
  el: AST.VElement,
  code: string,
  path: number[]
): Element {
  const attrs = el.startTag.attributes

  const start = startTag(
    attrs.map((attr, i) => transformAttribute(attr, i, code)),
    el.startTag.selfClosing,
    el.startTag.range
  )

  const end = el.endTag && endtag(el.endTag.range)

  return element(
    path,
    el.name,
    start,
    end,
    el.children.map((child, i) => transformChild(child, code, path.concat(i))),
    el.range
  )
}

function transformAttribute(
  attr: AST.VAttribute | AST.VDirective,
  index: number,
  code: string
): Attribute | Directive {
  if (attr.directive) {
    if (attr.key.name === 'for') {
      return transformVForDirective(attr, index, code)
    } else {
      return transformDirective(attr, index, code)
    }
  } else {
    return attribute(
      index,
      attr.key.name,
      attr.value && attr.value.value,
      attr.range
    )
  }
}

function transformDirective(
  node: AST.VDirective,
  index: number,
  code: string
): Directive {
  const exp = node.value && node.value.expression
  const expStr = exp ? extractExpression(exp, code) : null
  return directive(
    index,
    node.key.name,
    node.key.argument,
    node.key.modifiers,
    expStr,
    node.range
  )
}

function transformVForDirective(
  node: AST.VDirective,
  index: number,
  code: string
): VForDirective {
  const exp =
    node.value &&
    node.value.expression &&
    node.value.expression.type === 'VForExpression'
      ? node.value.expression
      : null

  return vForDirective(
    index,
    exp ? exp.left.map(l => extractExpression(l, code)) : [],
    exp && extractExpression(exp.right, code),
    node.range
  )
}

function transformChild(
  child: ChildNode,
  code: string,
  path: number[]
): ElementChild {
  switch (child.type) {
    case 'VElement':
      return transformElement(child, code, path)
    case 'VText':
      return textNode(path, child.value, child.range)
    case 'VExpressionContainer':
      const exp = child.expression
      return expressionNode(
        path,
        exp ? extractExpression(exp, code) : '',
        child.range
      )
  }
}

function extractExpression(node: AST.HasLocation, code: string): string {
  return code.slice(node.range[0], node.range[1])
}

export function getNode(
  root: Template,
  path: number[]
): ElementChild | undefined {
  function loop(
    current: ElementChild,
    rest: number[]
  ): ElementChild | undefined {
    // If `rest` does not have any items,
    // `current` is the node we are looking for.
    if (rest.length === 0) {
      return current
    }

    // The current node does not have children,
    // then we cannot traverse any more.
    if (current.type !== 'Element') {
      return undefined
    }

    const next = current.children[rest[0]]
    if (!next) {
      return undefined
    } else {
      return loop(next, rest.slice(1))
    }
  }
  const [index, ...rest] = path
  const el = root.children[index]
  return el && loop(el, rest)
}

export function insertNode(
  root: Template,
  path: number[],
  el: ElementChild
): Template {
  function loop<T extends Element | Template>(
    parent: T,
    index: number,
    rest: number[]
  ): T {
    assert(index != null, '[template] index should not be null or undefined')

    const cs = parent.children

    // If `rest` is empty, insert the node to `index`
    if (rest.length === 0) {
      assert(
        0 <= index && index <= cs.length,
        "[template] cannot insert the node to '" +
          path.join('->') +
          "' as the last index is out of possible range: " +
          `0 <= ${index} <= ${cs.length}`
      )

      return clone(parent, {
        children: [...cs.slice(0, index), el, ...cs.slice(index)]
      })
    }

    const child = parent.children[index] as Element
    assert(
      child,
      "[template] cannot reach to the path '" +
        path.join('->') +
        "' as there is no node on the way"
    )
    assert(
      child.type === 'Element',
      "[template] cannot reach to the path '" +
        path.join('->') +
        "' as there is text or expression node on the way"
    )

    const [head, ...tail] = rest
    return clone(parent, {
      children: [
        ...cs.slice(0, index),
        loop(child, head, tail),
        ...cs.slice(index + 1)
      ]
    })
  }
  return loop(root, path[0], path.slice(1))
}

export function visitElements(
  node: Template,
  fn: (el: Element) => Element | void
): Template {
  function loop(node: ElementChild): ElementChild {
    switch (node.type) {
      case 'Element':
        const newNode = clone(node, {
          children: node.children.map(loop)
        })
        return fn(newNode) || newNode
      default:
        // Do nothing
        return node
    }
  }
  return clone(node, {
    children: node.children.map(loop)
  })
}

export function addScope(node: Template, scope: string): Template {
  return visitElements(node, el => {
    return clone(el, {
      startTag: clone(el.startTag, {
        attributes: el.startTag.attributes.concat({
          type: 'Attribute',
          directive: false,
          index: -1,
          name: scopePrefix + scope,
          value: null,
          range: [-1, -1]
        })
      })
    })
  })
}

export type ElementChild = Element | TextNode | ExpressionNode

interface BaseNode extends Range {
  type: string
}

export interface Template extends BaseNode {
  type: 'Template'
  attributes: Attribute[]
  children: ElementChild[]
}

export interface Element extends BaseNode {
  type: 'Element'
  path: number[]
  name: string
  startTag: StartTag
  endTag: EndTag | null
  children: ElementChild[]
}

export interface StartTag extends BaseNode {
  type: 'StartTag'
  attributes: (Attribute | Directive)[]
  selfClosing: boolean
}

export interface EndTag extends BaseNode {
  type: 'EndTag'
}

export interface TextNode extends BaseNode {
  type: 'TextNode'
  path: number[]
  text: string
}

export interface ExpressionNode extends BaseNode {
  type: 'ExpressionNode'
  path: number[]
  expression: string
}

export interface Attribute extends BaseNode {
  type: 'Attribute'
  directive: false
  index: number
  name: string
  value: string | null
}

export interface Directive extends BaseNode {
  type: 'Attribute'
  directive: true
  index: number
  name: string
  argument: string | null
  modifiers: string[]
  expression: string | null
  value?: any
}

export interface VForDirective extends Directive {
  name: 'for'
  left: string[]
  right: string | null
}

function element(
  path: number[],
  name: string,
  startTag: StartTag,
  endTag: EndTag | null,
  children: ElementChild[],
  range: [number, number]
): Element {
  return {
    type: 'Element',
    path,
    name,
    startTag,
    endTag,
    children,
    range
  }
}

function startTag(
  attributes: (Attribute | Directive)[],
  selfClosing: boolean,
  range: [number, number]
): StartTag {
  return {
    type: 'StartTag',
    attributes,
    selfClosing,
    range
  }
}

function endtag(range: [number, number]): EndTag {
  return {
    type: 'EndTag',
    range
  }
}

function textNode(
  path: number[],
  text: string,
  range: [number, number]
): TextNode {
  return {
    type: 'TextNode',
    path,
    text,
    range
  }
}

function expressionNode(
  path: number[],
  expression: string,
  range: [number, number]
): ExpressionNode {
  return {
    type: 'ExpressionNode',
    path,
    expression,
    range
  }
}

function attribute(
  index: number,
  name: string,
  value: string | null,
  range: [number, number]
): Attribute {
  return {
    type: 'Attribute',
    directive: false,
    index,
    name,
    value,
    range
  }
}

function directive(
  index: number,
  name: string,
  argument: string | null,
  modifiers: string[],
  expression: string | null,
  range: [number, number]
): Directive {
  return {
    type: 'Attribute',
    directive: true,
    index,
    name,
    argument,
    modifiers,
    expression,
    range
  }
}

function vForDirective(
  index: number,
  left: string[],
  right: string | null,
  range: [number, number]
): VForDirective {
  return {
    type: 'Attribute',
    directive: true,
    index,
    name: 'for',
    argument: null,
    modifiers: [],
    expression: null,
    left,
    right,
    range
  }
}
