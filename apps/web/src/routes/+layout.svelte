<script lang="ts">
  import { onMount } from 'svelte';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';

  let { children } = $props();

  onMount(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js').catch(() => {
        /* регистрация сервис-воркера не критична для работы кабинета */
      });
    }
  });
</script>

<div class="flex min-h-screen flex-col">
  <header class="border-b border-border">
    <div class="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-4">
      <div class="flex items-center gap-2.5">
        <span
          class="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm font-bold text-accent-foreground"
        >
          Н
        </span>
        <span class="font-semibold">Нейровидео</span>
      </div>
      <ThemeToggle />
    </div>
  </header>

  <main class="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
    {@render children()}
  </main>

  <footer class="border-t border-border px-4 py-4 text-center text-xs text-muted-foreground">
    Кабинет селлера — скелет. Данные моковые, реального API ещё нет.
  </footer>
</div>
