<template>
  <Node
    v-bind="$props"
    :selectable="currentUri === uri"
    :selected="selected"
    v-on="$listeners"
  />
</template>

<script lang="ts">
import Vue from 'vue'
import Node from './Node.vue'
import { Element } from '@/parser/template'
import { DefaultValue, ChildComponent } from '@/parser/script'
import { projectHelpers } from '../store/modules/project'

export default Vue.extend({
  name: 'ContainerNode',

  beforeCreate() {
    this.$options.components!.Node = Node
  },

  props: {
    uri: {
      type: String,
      required: true
    },

    data: {
      type: Object as { (): Element },
      required: true
    },

    scope: {
      type: Object as { (): Record<string, DefaultValue> },
      required: true
    },

    childComponents: {
      type: Array as { (): ChildComponent[] },
      required: true
    }
  },

  computed: {
    ...projectHelpers.mapState(['selectedPath', 'currentUri']),

    selected(): boolean {
      const path = this.data.path

      if (path.length !== this.selectedPath.length) {
        return false
      }

      return path.reduce((acc, p, i) => {
        return acc && p === this.selectedPath[i]
      }, true)
    }
  }
})
</script>
