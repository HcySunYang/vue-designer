import assert from 'assert'
import { DefineModule, createNamespacedHelpers } from 'vuex'
import { VueFilePayload } from '@/parser/vue-file'
import {
  Template,
  Element,
  addScope as addScopeToTemplate,
  insertNode,
  getNode
} from '@/parser/template'
import { ClientConnection } from '@/view/communication'
import { mapValues } from '@/utils'
import { addScope as addScopeToStyle } from '@/parser/style'
import { genStyle } from '@/parser/style-codegen'
import { Prop, Data, ChildComponent } from '@/parser/script'

export interface ScopedDocument {
  uri: string
  displayName: string
  template: Template | undefined
  props: Prop[]
  data: Data[]
  childComponents: ChildComponent[]
  styleCode: string
}

export type DraggingPlace = 'before' | 'after' | 'first' | 'last'

export interface ProjectState {
  documents: Record<string, VueFilePayload>
  currentUri: string | undefined
  draggingUri: string | undefined
  selectedPath: number[]
  draggingPath: number[]
}

interface ProjectGetters {
  scopedDocuments: Record<string, ScopedDocument>
  currentDocument: VueFilePayload | undefined
  currentRenderingDocument: ScopedDocument | undefined
  draggingScopedDocument: ScopedDocument | undefined
  localNameOfDragging: string | undefined
  nodeOfDragging: Element | undefined
}

interface ProjectActions {
  init: ClientConnection
  select: Element
  applyDraggingElement: undefined
  startDragging: string
  endDragging: undefined
  setDraggingPlace: { path: number[]; place: DraggingPlace }
}

interface ProjectMutations {
  setDocuments: Record<string, VueFilePayload>
  changeDocument: string
  select: Element
  addElement: { path: number[]; node: Element }
  addChildComponent: ChildComponent
  setDraggingUri: string | undefined
  setDraggingPath: number[]
}

export const projectHelpers = createNamespacedHelpers<
  ProjectState,
  ProjectGetters,
  ProjectMutations,
  ProjectActions
>('project')

let connection: ClientConnection
let draggingTimer: any
const draggingInterval = 80

export const project: DefineModule<
  ProjectState,
  ProjectGetters,
  ProjectMutations,
  ProjectActions
> = {
  namespaced: true,

  state: () => ({
    documents: {},
    currentUri: undefined,
    draggingUri: undefined,
    selectedPath: [],
    draggingPath: []
  }),

  getters: {
    scopedDocuments(state) {
      return mapValues(state.documents, doc => {
        const pathEls = doc.uri.split('/')
        const displayName = pathEls[pathEls.length - 1].replace(/\..*$/, '')

        return {
          uri: doc.uri,
          displayName,
          template:
            doc.template && addScopeToTemplate(doc.template, doc.scopeId),
          props: doc.props,
          data: doc.data,
          childComponents: doc.childComponents,
          styleCode: doc.styles
            .reduce<string[]>((acc, style) => {
              return acc.concat(genStyle(addScopeToStyle(style, doc.scopeId)))
            }, [])
            .join('\n')
        }
      })
    },

    currentDocument(state) {
      if (!state.currentUri) {
        return undefined
      }
      return state.documents[state.currentUri]
    },

    currentRenderingDocument(state, getters) {
      if (!state.currentUri) {
        return undefined
      }

      const doc = getters.scopedDocuments[state.currentUri]
      if (!doc) {
        return undefined
      }

      const dragging = getters.draggingScopedDocument
      const insertInto = state.draggingPath
      const newNode = getters.nodeOfDragging
      if (!doc.template || !dragging || insertInto.length === 0 || !newNode) {
        return doc
      }

      const newChildComponents = getters.localNameOfDragging
        ? doc.childComponents
        : doc.childComponents.concat({
            name: dragging.displayName,
            uri: dragging.uri
          })

      return {
        ...doc,
        childComponents: newChildComponents,
        template: insertNode(doc.template, insertInto, newNode)
      }
    },

    draggingScopedDocument(state, getters) {
      return state.draggingUri
        ? getters.scopedDocuments[state.draggingUri]
        : undefined
    },

    localNameOfDragging(state, getters) {
      const doc = state.currentUri && getters.scopedDocuments[state.currentUri]
      const dragging = getters.draggingScopedDocument

      if (!doc || !dragging) {
        return undefined
      }

      return doc.childComponents.reduce<string | undefined>((acc, comp) => {
        if (acc) return acc

        if (comp.uri === dragging.uri) {
          return comp.name
        }
      }, undefined)
    },

    nodeOfDragging(_state, getters) {
      const dragging = getters.draggingScopedDocument
      if (!dragging) {
        return
      }

      const localName = getters.localNameOfDragging
      return {
        type: 'Element',
        path: [],
        name: localName || dragging.displayName,
        startTag: {
          type: 'StartTag',
          attributes: [],
          selfClosing: false,
          range: [-1, -1]
        },
        endTag: {
          type: 'EndTag',
          range: [-1, -1]
        },
        children: [],
        range: [-1, -1]
      }
    }
  },

  actions: {
    init({ commit }, conn) {
      connection = conn
      connection.onMessage(data => {
        switch (data.type) {
          case 'InitProject':
            commit('setDocuments', data.vueFiles)
            break
          case 'ChangeDocument':
            commit('changeDocument', data.uri)
            break
          default: // Do nothing
        }
      })
    },

    select({ commit, getters }, node) {
      const current = getters.currentDocument
      if (!current) return

      connection.send({
        type: 'SelectNode',
        uri: current.uri,
        path: node.path
      })
      commit('select', node)
    },

    applyDraggingElement({ commit, state, getters }) {
      const currentUri = state.currentUri
      const nodeUri = state.draggingUri
      const path = state.draggingPath
      const newNode = getters.nodeOfDragging

      if (!currentUri || !nodeUri || path.length === 0 || !newNode) {
        return
      }

      connection.send({
        type: 'AddNode',
        path,
        currentUri,
        nodeUri
      })

      commit('addElement', {
        path,
        node: newNode
      })

      const localName = getters.localNameOfDragging
      if (!localName) {
        commit('addChildComponent', {
          name: newNode.name,
          uri: state.draggingUri!
        })
      }
    },

    startDragging({ commit }, uri) {
      commit('setDraggingUri', uri)
    },

    endDragging({ commit }) {
      commit('setDraggingUri', undefined)
      commit('setDraggingPath', [])
    },

    setDraggingPlace({ state, getters, commit }, { path, place }) {
      clearTimeout(draggingTimer)
      draggingTimer = setTimeout(() => {
        const doc = getters.currentDocument
        if (!doc || !doc.template) {
          return
        }

        const node = getNode(doc.template, path)
        if (!node) {
          return
        }

        let insertInto: number[]
        if (place === 'before') {
          insertInto = node.path
        } else if (place === 'after') {
          const last = node.path[node.path.length - 1]
          insertInto = node.path.slice(0, -1).concat(last + 1)
        } else if (place === 'first') {
          const el = node as Element
          assert(
            el.type === 'Element',
            `[store/project] node type must be 'Element' when place is 'first' but received '${
              node.type
            }'`
          )
          insertInto = el.path.concat(0)
        } else {
          const el = node as Element
          assert(
            el.type === 'Element',
            `[store/project] node type must be 'Element' when place is 'last' but received '${
              node.type
            }'`
          )
          const len = el.children.length
          insertInto = el.path.concat(len)
        }

        const isUpdated =
          state.draggingPath.length !== insertInto.length ||
          path.reduce((acc, el, i) => {
            return acc || state.draggingPath[i] !== el
          }, false)

        if (isUpdated) {
          commit('setDraggingPath', insertInto)
        }
      }, draggingInterval)
    }
  },

  mutations: {
    setDocuments(state, vueFiles) {
      state.documents = vueFiles
    },

    changeDocument(state, uri) {
      state.currentUri = uri
      state.selectedPath = []
    },

    select(state, node) {
      state.selectedPath = node.path
    },

    addElement(state, { path, node }) {
      const uri = state.currentUri
      if (uri) {
        const doc = state.documents[uri]
        if (doc && doc.template) {
          doc.template = insertNode(doc.template, path, node)
        }
      }
    },

    addChildComponent(state, childComponent) {
      const uri = state.currentUri
      if (uri) {
        const doc = state.documents[uri]
        if (doc) {
          doc.childComponents = doc.childComponents.concat(childComponent)
        }
      }
    },

    setDraggingUri(state, uri) {
      state.draggingUri = uri
    },

    setDraggingPath(state, path) {
      state.draggingPath = path
    }
  }
}
