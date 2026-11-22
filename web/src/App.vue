<template>
  <div id="app">
    <NavBar v-if="!route.meta.public" />
    <main class="content" :class="{ 'content--public': route.meta.public }">
      <router-view />
    </main>
  </div>
</template>

<script setup lang="ts">
import NavBar from './components/NavBar.vue';
import './composables/useTheme';
import { useRoute } from 'vue-router';

const route = useRoute();
</script>

<style>
.content {
  flex: 1;
  display: flex;
  flex-direction: column;
}
.content--public { display: block; }
</style>
