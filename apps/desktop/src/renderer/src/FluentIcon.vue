<script setup lang="ts">
defineProps<{
  svg: string;
  label?: string;
}>();
</script>

<template>
  <span
    class="fluent-icon"
    :aria-hidden="label ? undefined : 'true'"
    :aria-label="label"
    :role="label ? 'img' : undefined"
    v-html="svg"
  ></span>
</template>
